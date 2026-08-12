import Fastify from 'fastify';
import path from 'path';
import fastifyStatic from '@fastify/static';
import cors from '@fastify/cors';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { nanoid } from 'nanoid';

import { createInbox, getInbox, insertRequest, getRequestsForInbox, getRequestById } from './db';

const fastify = Fastify({ logger: true });

const allowedOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';

fastify.register(cors, {
  origin: allowedOrigin,
});

fastify.register(fastifyStatic, {
  root: path.join(__dirname, '../public'),
});

// Track WS connections per inbox: inboxId -> Set of sockets
const inboxSubscribers = new Map<string, Set<WebSocket>>();

function broadcastToInbox(inboxId: string, data: unknown) {
  const subscribers = inboxSubscribers.get(inboxId);
  if (!subscribers) return;
  const payload = JSON.stringify(data);
  for (const socket of subscribers) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  }
}

// Create a new inbox
fastify.post('/api/inboxes', async (request, reply) => {
  const id = nanoid(10);
  createInbox(id);
  return { id };
});

// Get all requests for an inbox
fastify.get('/api/inboxes/:id/requests', async (request, reply) => {
  const { id } = request.params as { id: string };
  const inbox = getInbox(id);
  if (!inbox) {
    reply.code(404);
    return { error: 'Inbox not found' };
  }
  const requests = getRequestsForInbox(id);
  return { requests };
});

// Replay a captured request to a target URL
fastify.post('/api/replay', async (request, reply) => {
  const { requestId, targetUrl } = request.body as { requestId: string; targetUrl: string };

  const captured = getRequestById(requestId);
  if (!captured) {
    reply.code(404);
    return { error: 'Request not found' };
  }

  try {
    const headers = JSON.parse(captured.headers);
    // Strip headers that shouldn't be forwarded as-is
    delete headers.host;
    delete headers['content-length'];

    const res = await fetch(targetUrl, {
      method: captured.method,
      headers,
      body: captured.body ?? undefined,
    });

    return {
      success: true,
      status: res.status,
      statusText: res.statusText,
    };
  } catch (err) {
    reply.code(500);
    return { success: false, error: (err as Error).message };
  }
});

// Catch-all: accept ANY method/path under /i/:inboxId
fastify.all('/i/:inboxId/*', async (request, reply) => {
  const { inboxId } = request.params as { inboxId: string };
  const inbox = getInbox(inboxId);

  if (!inbox) {
    reply.code(404);
    return { error: 'Inbox not found' };
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
  broadcastToInbox(inboxId, { type: 'new_request', request: captured });

  return { received: true, id: reqId };
});

// Handle the root case too: /i/:inboxId with nothing after it
fastify.all('/i/:inboxId', async (request, reply) => {
  const { inboxId } = request.params as { inboxId: string };
  const inbox = getInbox(inboxId);

  if (!inbox) {
    reply.code(404);
    return { error: 'Inbox not found' };
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
  broadcastToInbox(inboxId, { type: 'new_request', request: captured });

  return { received: true, id: reqId };
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });

    // Attach WebSocket server to the same HTTP server
    const wss = new WebSocketServer({ server: fastify.server });

    wss.on('connection', (socket, req) => {
      const url = new URL(req.url ?? '', 'http://localhost');
      const inboxId = url.searchParams.get('inboxId');

      if (!inboxId) {
        socket.close();
        return;
      }

      if (!inboxSubscribers.has(inboxId)) {
        inboxSubscribers.set(inboxId, new Set());
      }
      inboxSubscribers.get(inboxId)!.add(socket);

      socket.on('close', () => {
        inboxSubscribers.get(inboxId)?.delete(socket);
      });
    });

    console.log('Server running on http://localhost:3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Verify a Stripe webhook signature
fastify.post('/api/verify-stripe-signature', async (request, reply) => {
  const { payload, signatureHeader, secret } = request.body as {
    payload: string;
    signatureHeader: string;
    secret: string;
  };

  try {
    // Stripe-Signature header format: "t=timestamp,v1=signature"
    const parts = signatureHeader.split(',').reduce((acc, part) => {
      const [key, value] = part.split('=');
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);

    const timestamp = parts['t'];
    const receivedSignature = parts['v1'];

    if (!timestamp || !receivedSignature) {
      return { valid: false, reason: 'Missing timestamp or v1 signature in header' };
    }

    const signedPayload = `${timestamp}.${payload}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    const valid = crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(receivedSignature)
    );

    return { valid, expectedSignature, receivedSignature };
  } catch (err) {
    return { valid: false, reason: (err as Error).message };
  }
});

start();