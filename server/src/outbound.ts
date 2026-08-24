import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import {
  resolveSafeDestination,
  type ResolvedDestination,
} from "./manualRequest";
import {
  outboundMaxConcurrency,
  outboundMaxResponseBytes,
  outboundTimeoutMs,
} from "./runtimeConfig";

export {
  outboundMaxConcurrency,
  outboundMaxResponseBytes,
  outboundTimeoutMs,
} from "./runtimeConfig";

export class OutboundDestinationError extends Error {
  readonly code = "destination_rejected";
}

export class OutboundCapacityError extends Error {
  readonly code = "capacity_exceeded";
}

export class OutboundTimeoutError extends Error {
  readonly code = "timeout";
}

export class OutboundResponseTooLargeError extends Error {
  readonly code = "response_too_large";
}

export class OutboundLimiter {
  private active = 0;

  constructor(private readonly maxConcurrency: number) {}

  run<T>(operation: () => Promise<T>) {
    if (this.active >= this.maxConcurrency) {
      return Promise.reject(
        new OutboundCapacityError("Outbound request capacity reached"),
      );
    }

    this.active += 1;
    return Promise.resolve()
      .then(operation)
      .finally(() => {
        this.active -= 1;
      });
  }
}

export function createOutboundLimiter(maxConcurrency: number) {
  return new OutboundLimiter(maxConcurrency);
}

export const outboundLimiter = createOutboundLimiter(outboundMaxConcurrency);

const hopByHopHeaders = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const replayCredentialHeaders = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-access-token",
  "stripe-signature",
  "x-webhook-signature",
  "x-hub-signature",
  "x-hub-signature-256",
]);

export function filterReplayHeaders(headers: Record<string, unknown>) {
  const filtered: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (
      hopByHopHeaders.has(normalizedName) ||
      replayCredentialHeaders.has(normalizedName) ||
      typeof value !== "string"
    ) {
      continue;
    }
    filtered[name] = value;
  }
  return filtered;
}

export function isOutboundRedirect(status: number) {
  return status >= 300 && status < 400;
}

export type OutboundRequestOptions = {
  method: string;
  headers: Record<string, string>;
  body?: string;
  path?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export type OutboundResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
};

function responseHeaders(headers: http.IncomingHttpHeaders) {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.join(", ") : (value ?? ""),
    ]),
  );
}

export async function executePinnedRequest(
  resolved: ResolvedDestination,
  options: OutboundRequestOptions,
): Promise<OutboundResponse> {
  const transport = resolved.destination.protocol === "https:" ? https : http;
  const hostname = resolved.destination.hostname.replace(/^\[|\]$/g, "");
  const timeoutMs = options.timeoutMs ?? outboundTimeoutMs;
  const maxResponseBytes =
    options.maxResponseBytes ?? outboundMaxResponseBytes;
  const requestPath =
    options.path ?? `${resolved.destination.pathname}${resolved.destination.search}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };

    const requestOptions: http.RequestOptions = {
      protocol: resolved.destination.protocol,
      hostname,
      port: resolved.destination.port || undefined,
      method: options.method,
      path: requestPath,
      headers: options.headers,
      lookup: (_hostname, _lookupOptions, callback) => {
        if (_lookupOptions.all) {
          callback(null, [
            { address: resolved.address, family: resolved.family },
          ]);
          return;
        }
        callback(null, resolved.address, resolved.family);
      },
    };
    if (resolved.destination.protocol === "https:" && isIP(hostname) === 0) {
      Object.assign(requestOptions, { servername: hostname });
    }

    const request = transport.request(requestOptions, (response) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.length;
        if (totalBytes > maxResponseBytes) {
          finish(() =>
            reject(
              new OutboundResponseTooLargeError(
                "Target response exceeded the maximum size",
              ),
            ),
          );
          response.destroy();
          return;
        }
        chunks.push(buffer);
      });

      response.on("end", () => {
        finish(() =>
          resolve({
            status: response.statusCode ?? 502,
            statusText: response.statusMessage ?? "",
            headers: responseHeaders(response.headers),
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      });

      response.on("aborted", () => {
        finish(() => reject(new Error("Outbound response was aborted")));
      });
    });

    const timeout = setTimeout(() => {
      request.destroy(new OutboundTimeoutError("Outbound request timed out"));
    }, timeoutMs);

    request.on("timeout", () => {
      request.destroy(new OutboundTimeoutError("Outbound request timed out"));
    });
    request.on("error", (error) => {
      finish(() => reject(error));
    });

    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

export async function executeOutboundRequest(
  targetUrl: string,
  options: OutboundRequestOptions,
) {
  return outboundLimiter.run(async () => {
    const resolved = await resolveSafeDestination(targetUrl);
    if ("error" in resolved) {
      throw new OutboundDestinationError(resolved.error);
    }
    return executePinnedRequest(resolved, options);
  });
}

export function isRequestOwnedByInbox(
  captured: { inbox_id?: string } | undefined,
  inboxId: string,
) {
  return Boolean(captured && inboxId && captured.inbox_id === inboxId);
}

export type ReplayInput = {
  inboxId: string;
  requestId: string;
  targetUrl: string;
};

export function parseReplayInput(body: unknown): ReplayInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  if (
    typeof input.inboxId !== "string" ||
    typeof input.requestId !== "string" ||
    typeof input.targetUrl !== "string" ||
    !input.inboxId.trim() ||
    !input.requestId.trim() ||
    !input.targetUrl.trim()
  ) {
    return null;
  }
  return {
    inboxId: input.inboxId,
    requestId: input.requestId,
    targetUrl: input.targetUrl,
  };
}
