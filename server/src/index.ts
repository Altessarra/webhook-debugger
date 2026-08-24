import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import fs from "fs";
import path from "path";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import crypto from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import { nanoid } from "nanoid";

import {
  createInbox,
  decodeRequestCursor,
  deleteExpiredRequests,
  getInbox,
  getRequestById,
  getRequestsForInbox,
  insertRequest,
  pruneInboxRequests,
} from "./db";
import { getSafeHeaders, validateManualRequest } from "./manualRequest";
import {
  executeOutboundRequest,
  filterReplayHeaders,
  isOutboundRedirect,
  isRequestOwnedByInbox,
  OutboundCapacityError,
  OutboundDestinationError,
  OutboundResponseTooLargeError,
  OutboundTimeoutError,
  parseReplayInput,
} from "./outbound";
import { FixedWindowLimiter } from "./rateLimit";
import {
  historyDefaultPageSize,
  historyReadRateLimit,
  inboxCreationRateLimit,
  manualSendRateLimit,
  maxRateLimitKeys,
  maxRequestsPerInbox,
  rateLimitWindowMs,
  replayRateLimit,
  requestRetentionHours,
  retentionCleanupIntervalMs,
  webhookIngestionRateLimit,
} from "./runtimeConfig";

type RoutePolicy =
  | "inbox-create"
  | "webhook-ingest"
  | "history-read"
  | "manual-send"
  | "replay";

type BuildServerOptions = {
  now?: () => number;
  rateLimits?: Partial<Record<RoutePolicy, number>>;
};

const defaultRateLimits: Record<RoutePolicy, number> = {
  "inbox-create": inboxCreationRateLimit,
  "webhook-ingest": webhookIngestionRateLimit,
  "history-read": historyReadRateLimit,
  "manual-send": manualSendRateLimit,
  replay: replayRateLimit,
};

const inboxSubscribers = new Map<string, Set<WebSocket>>();

function broadcastToInbox(inboxId: string, data: unknown) {
  const subscribers = inboxSubscribers.get(inboxId);
  if (!subscribers) return;
  const payload = JSON.stringify(data);
  for (const socket of subscribers) {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  }
}

function getHistoryPageLimit(value: unknown) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return historyDefaultPageSize;
  }

  return Math.max(1, Math.min(100, Number(value)));
}

function rateLimit(
  limiter: FixedWindowLimiter,
  key: string,
  reply: FastifyReply,
) {
  const decision = limiter.check(key);
  if (decision.allowed) return false;

  reply.header("Retry-After", String(decision.retryAfterSeconds ?? 1));
  reply.code(429);
  return true;
}

function addWebSocketServer(fastify: FastifyInstance) {
  const wss = new WebSocketServer({ server: fastify.server });

  wss.on("connection", (socket, req) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const inboxId = url.searchParams.get("inboxId");
    if (!inboxId) {
      socket.close();
      return;
    }

    if (!inboxSubscribers.has(inboxId)) {
      inboxSubscribers.set(inboxId, new Set());
    }
    inboxSubscribers.get(inboxId)!.add(socket);
    socket.on("close", () => inboxSubscribers.get(inboxId)?.delete(socket));
  });
}

export function runRetentionCleanup(fastify: FastifyInstance) {
  const deleted = deleteExpiredRequests(
    Date.now() - requestRetentionHours * 60 * 60 * 1000,
  );
  fastify.log.info({ deleted }, "Deleted expired requests");
  return deleted;
}

function scheduleRetentionCleanup(fastify: FastifyInstance) {
  runRetentionCleanup(fastify);
  const timer = setInterval(
    () => runRetentionCleanup(fastify),
    retentionCleanupIntervalMs,
  );
  timer.unref();
  fastify.addHook("onClose", () => clearInterval(timer));
}

export function buildServer(options: BuildServerOptions = {}) {
  const fastify = Fastify({ logger: true });
  const allowedOrigin = process.env.CORS_ORIGIN || "http://localhost:5173";
  const configuredLimits = { ...defaultRateLimits, ...options.rateLimits };
  const limiters = Object.fromEntries(
    (Object.keys(configuredLimits) as RoutePolicy[]).map((policy) => [
      policy,
      new FixedWindowLimiter({
        limit: configuredLimits[policy],
        windowMs: rateLimitWindowMs,
        maxKeys: maxRateLimitKeys,
        now: options.now,
      }),
    ]),
  ) as Record<RoutePolicy, FixedWindowLimiter>;

  fastify.register(cors, { origin: allowedOrigin });

  const publicRoot = path.join(__dirname, "../public");
  if (fs.existsSync(publicRoot)) {
    fastify.register(fastifyStatic, { root: publicRoot });
  }

  fastify.post("/api/inboxes", async (request, reply) => {
    if (rateLimit(limiters["inbox-create"], request.ip, reply)) {
      return { error: "Rate limit exceeded" };
    }

    const id = nanoid(10);
    createInbox(id);
    return { id };
  });

  fastify.get("/api/inboxes/:id/requests", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (rateLimit(limiters["history-read"], id, reply)) {
      return { error: "Rate limit exceeded" };
    }

    const inbox = getInbox(id);
    if (!inbox) {
      reply.code(404);
      return { error: "Inbox not found" };
    }

    const { limit, cursor } = request.query as {
      limit?: string;
      cursor?: string;
    };
    try {
      return getRequestsForInbox(id, {
        limit: getHistoryPageLimit(limit),
        ...(cursor !== undefined ? { cursor: decodeRequestCursor(cursor) } : {}),
      });
    } catch {
      reply.code(400);
      return { error: "Invalid request cursor" };
    }
  });

  fastify.post("/api/replay", async (request, reply) => {
    if (rateLimit(limiters.replay, request.ip, reply)) {
      return { error: "Rate limit exceeded" };
    }

    const input = parseReplayInput(request.body);
    if (!input) {
      reply.code(400);
      return {
        success: false,
        error: "Inbox ID, request ID, and target URL are required",
      };
    }

    const captured = getRequestById(input.requestId);
    if (!captured || !isRequestOwnedByInbox(captured, input.inboxId)) {
      reply.code(404);
      return { error: "Request not found" };
    }

    try {
      const headers = filterReplayHeaders(JSON.parse(captured.headers));
      const canHaveBody = !["GET", "HEAD"].includes(captured.method);
      const response = await executeOutboundRequest(input.targetUrl, {
        method: captured.method,
        headers,
        ...(canHaveBody && captured.body !== null ? { body: captured.body } : {}),
      });

      return {
        success: true,
        status: response.status,
        statusText: response.statusText,
        redirected: isOutboundRedirect(response.status),
      };
    } catch (err) {
      if (err instanceof OutboundDestinationError) reply.code(400);
      else if (err instanceof OutboundCapacityError) reply.code(429);
      else if (err instanceof OutboundTimeoutError) reply.code(504);
      else reply.code(502);
      return {
        success: false,
        error:
          err instanceof OutboundDestinationError
            ? err.message
            : err instanceof OutboundCapacityError
              ? "Outbound request capacity reached"
              : err instanceof OutboundTimeoutError
                ? "Outbound request timed out"
                : err instanceof OutboundResponseTooLargeError
                  ? "Target response exceeded the maximum size"
                  : "Unable to reach target",
      };
    }
  });

  fastify.post("/api/send", async (request, reply) => {
    if (rateLimit(limiters["manual-send"], request.ip, reply)) {
      return { error: "Rate limit exceeded" };
    }

    const input = request.body as {
      method?: string;
      targetUrl?: string;
      headers?: string;
      body?: string;
    };
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      reply.code(400);
      return { success: false, error: "Request body is required" };
    }
    const method = input.method ?? "";
    const targetUrl = input.targetUrl ?? "";
    const headers = input.headers ?? "{}";
    const body = input.body ?? "";
    const validationError = validateManualRequest({
      method,
      targetUrl,
      headers,
      body,
    });
    if (validationError) {
      reply.code(400);
      return { success: false, error: validationError };
    }

    try {
      const hasBody = body.trim().length > 0;
      const startedAt = Date.now();
      const response = await executeOutboundRequest(targetUrl, {
        method,
        headers: getSafeHeaders(headers),
        ...(hasBody ? { body } : {}),
      });

      return {
        success: true,
        status: response.status,
        statusText: response.statusText,
        redirected: isOutboundRedirect(response.status),
        responseBody: response.body,
        responseHeaders: response.headers,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      if (err instanceof OutboundDestinationError) reply.code(400);
      else if (err instanceof OutboundCapacityError) reply.code(429);
      else if (err instanceof OutboundTimeoutError) reply.code(504);
      else reply.code(502);
      return {
        success: false,
        error:
          err instanceof OutboundDestinationError
            ? err.message
            : err instanceof OutboundCapacityError
              ? "Outbound request capacity reached"
              : err instanceof OutboundTimeoutError
                ? "Outbound request timed out"
                : err instanceof OutboundResponseTooLargeError
                  ? "Target response exceeded the maximum size"
                  : "Unable to reach target",
      };
    }
  });

  const captureInboxRequest = async (
    request: FastifyRequest<{ Params: { inboxId: string } }>,
    reply: FastifyReply,
  ) => {
    const { inboxId } = request.params;
    if (rateLimit(limiters["webhook-ingest"], inboxId, reply)) {
      return { error: "Rate limit exceeded" };
    }

    const inbox = getInbox(inboxId);
    if (!inbox) {
      reply.code(404);
      return { error: "Inbox not found" };
    }

    const reqId = nanoid();
    const createdAt = Date.now();
    const captured = {
      id: reqId,
      inboxId,
      method: request.method,
      path: request.url,
      headers: JSON.stringify(request.headers),
      body: request.body ? JSON.stringify(request.body) : null,
      query: JSON.stringify(request.query),
      createdAt,
    };
    insertRequest(captured);
    pruneInboxRequests(inboxId, maxRequestsPerInbox);
    broadcastToInbox(inboxId, { type: "new_request", request: captured });

    return { received: true, id: reqId };
  };

  fastify.all("/i/:inboxId/*", captureInboxRequest);
  fastify.all("/i/:inboxId", captureInboxRequest);

  fastify.post("/api/verify-stripe-signature", async (request) => {
    const { payload, signatureHeader, secret } = request.body as {
      payload: string;
      signatureHeader: string;
      secret: string;
    };

    try {
      const parts = signatureHeader.split(",").reduce(
        (acc, part) => {
          const [key, value] = part.split("=");
          acc[key] = value;
          return acc;
        },
        {} as Record<string, string>,
      );
      const timestamp = parts.t;
      const receivedSignature = parts.v1;
      if (!timestamp || !receivedSignature) {
        return {
          valid: false,
          reason: "Missing timestamp or v1 signature in header",
        };
      }

      const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(`${timestamp}.${payload}`)
        .digest("hex");
      const valid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(receivedSignature),
      );
      return { valid, expectedSignature, receivedSignature };
    } catch (err) {
      return { valid: false, reason: (err as Error).message };
    }
  });

  fastify.setNotFoundHandler(async (request, reply) => {
    const isApiPath = request.url === "/api" || request.url.startsWith("/api/");
    const isWebhookPath = request.url === "/i" || request.url.startsWith("/i/");
    const isFrontendPath = request.method === "GET" && !isApiPath && !isWebhookPath;
    if (isFrontendPath) return reply.sendFile("index.html");
    return reply.code(404).send({ error: "Not found" });
  });

  return fastify;
}

export const fastify = buildServer();

export async function startServer() {
  try {
    await fastify.listen({ port: 3000, host: "0.0.0.0" });
    addWebSocketServer(fastify);
    scheduleRetentionCleanup(fastify);
    console.log("Server running on http://localhost:3000");
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  void startServer();
}
