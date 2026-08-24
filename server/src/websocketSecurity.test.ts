import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, test } from "node:test";
import { WebSocket, type ClientOptions } from "ws";

import { createInbox } from "./db";
import { attachWebSocketServer, fastify, startServer } from "./index";

const ownedServers: Array<http.Server> = [];
const ownedSockets: WebSocket[] = [];
const cleanups: Array<() => void> = [];
const timerRestores: Array<() => void> = [];

afterEach(async () => {
  for (const socket of ownedSockets.splice(0)) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.terminate();
    }
  }
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const restore of timerRestores.splice(0)) restore();
  await Promise.all(
    ownedServers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

function createInboxId() {
  const id = `ws-${Math.random().toString(36).slice(2)}`;
  createInbox(id);
  return id;
}

async function createTestServerWithControl() {
  const server = http.createServer();
  ownedServers.push(server);
  cleanups.push(attachWebSocketServer(server));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { endpoint: `ws://127.0.0.1:${address.port}`, server };
}

async function createTestServer() {
  return (await createTestServerWithControl()).endpoint;
}

type TestClientOptions = ClientOptions & { autoPong?: boolean };

function connect(url: string, options: TestClientOptions = {}) {
  const socket = new WebSocket(url, options);
  ownedSockets.push(socket);
  return socket;
}

function opens(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function closes(socket: WebSocket) {
  return new Promise<{ code: number }>((resolve) => {
    socket.once("close", (code) => resolve({ code }));
  });
}

function rejectsUpgrade(socket: WebSocket) {
  return new Promise<number>((resolve) => {
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    socket.once("error", () => resolve(0));
  });
}

function upgradeOutcome(socket: WebSocket) {
  return new Promise<number | "open">((resolve) => {
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    socket.once("open", () => resolve("open"));
    socket.once("error", () => resolve(0));
  });
}

function controlHeartbeat() {
  const originalSetInterval = globalThis.setInterval;
  const originalNow = Date.now;
  const callbacks: Array<() => void> = [];
  let now = 0;

  globalThis.setInterval = ((callback: () => void) => {
    callbacks.push(callback);
    const timer = originalSetInterval(() => undefined, 2_147_483_647);
    timer.unref();
    return timer;
  }) as typeof setInterval;
  Date.now = () => now;

  return {
    advance: () => {
      now += 30_000;
      for (const callback of callbacks) callback();
    },
    restore: () => {
      globalThis.setInterval = originalSetInterval;
      Date.now = originalNow;
    },
  };
}

test("rejects upgrade paths other than the inbox subscription root", async () => {
  const endpoint = await createTestServer();
  const socket = connect(`${endpoint}/not-a-subscription?inboxId=${createInboxId()}`);

  assert.equal(await rejectsUpgrade(socket), 404);
});

test("rejects browser upgrades from an origin other than the configured application origin", async () => {
  const endpoint = await createTestServer();
  const socket = connect(`${endpoint}/?inboxId=${createInboxId()}`, {
    headers: { origin: "https://untrusted.example" },
  });

  assert.equal(await rejectsUpgrade(socket), 403);
});

test("rejects subscriptions for inboxes that do not exist", async () => {
  const endpoint = await createTestServer();
  const socket = connect(`${endpoint}/?inboxId=missing-inbox`);

  assert.equal(await rejectsUpgrade(socket), 404);
});

test("rejects the eleventh concurrent subscription from one IP and releases the slot on close", async () => {
  const endpoint = await createTestServer();
  const inboxId = createInboxId();
  const sockets = await Promise.all(
    Array.from({ length: 10 }, async () => {
      const socket = connect(`${endpoint}/?inboxId=${inboxId}`);
      await opens(socket);
      return socket;
    }),
  );
  const overLimit = connect(`${endpoint}/?inboxId=${inboxId}`);
  assert.equal(await rejectsUpgrade(overLimit), 429);

  const closed = closes(sockets[0]!);
  sockets[0]!.close();
  await closed;

  const replacement = connect(`${endpoint}/?inboxId=${inboxId}`);
  await opens(replacement);
});

test("keeps existing IP reservations when an upgrade handler throws", async () => {
  const { endpoint, server } = await createTestServerWithControl();
  const inboxId = createInboxId();
  let capturedRequest: http.IncomingMessage | undefined;
  let capturedSocket: import("node:stream").Duplex | undefined;
  let capturedHead: Buffer | undefined;
  server.once("upgrade", (request, socket, head) => {
    capturedRequest = request;
    capturedSocket = socket;
    capturedHead = head;
  });

  const existing = connect(`${endpoint}/?inboxId=${inboxId}`);
  await opens(existing);
  assert.ok(capturedRequest && capturedSocket && capturedHead);

  const originalWrite = capturedSocket.write;
  const originalDestroy = capturedSocket.destroy;
  capturedSocket.write = (() => true) as typeof capturedSocket.write;
  capturedSocket.destroy = (() => capturedSocket) as typeof capturedSocket.destroy;
  try {
    server.emit("upgrade", capturedRequest, capturedSocket, capturedHead);
  } finally {
    capturedSocket.write = originalWrite;
    capturedSocket.destroy = originalDestroy;
  }

  for (let index = 0; index < 9; index += 1) {
    await opens(connect(`${endpoint}/?inboxId=${inboxId}`));
  }
  const overLimit = connect(`${endpoint}/?inboxId=${inboxId}`);
  assert.equal(await upgradeOutcome(overLimit), 429);
});

test("enforces the configured payload cap before registering client data", async () => {
  const endpoint = await createTestServer();
  const socket = connect(`${endpoint}/?inboxId=${createInboxId()}`);
  await opens(socket);
  const closed = closes(socket);

  socket.send("x".repeat(65_537));

  assert.equal((await closed).code, 1009);
});

test("closes client messages because subscriptions are server-push only", async () => {
  const endpoint = await createTestServer();
  const socket = connect(`${endpoint}/?inboxId=${createInboxId()}`);
  await opens(socket);
  const closed = closes(socket);

  socket.send("subscribe");

  assert.equal((await closed).code, 1008);
});

test("refreshes liveness after a pong across a later heartbeat cutoff", async () => {
  const heartbeat = controlHeartbeat();
  timerRestores.push(heartbeat.restore);
  const endpoint = await createTestServer();
  const socket = connect(`${endpoint}/?inboxId=${createInboxId()}`);
  await opens(socket);

  const ping = new Promise<void>((resolve) => socket.once("ping", () => resolve()));
  heartbeat.advance();
  await ping;
  await new Promise<void>((resolve) => setImmediate(resolve));
  const laterPing = new Promise<void>((resolve) => socket.once("ping", () => resolve()));
  heartbeat.advance();
  await laterPing;
  await new Promise<void>((resolve) => setImmediate(resolve));
  heartbeat.advance();
  assert.equal(socket.readyState, WebSocket.OPEN);
});

test("terminates an idle subscription that does not answer a heartbeat", async () => {
  const heartbeat = controlHeartbeat();
  timerRestores.push(heartbeat.restore);
  const endpoint = await createTestServer();
  const socket = connect(`${endpoint}/?inboxId=${createInboxId()}`, { autoPong: false });
  await opens(socket);
  const closed = closes(socket);

  heartbeat.advance();
  heartbeat.advance();
  heartbeat.advance();

  assert.equal((await closed).code, 1006);
});

test("removes an empty subscriber set when the final socket closes", async () => {
  const endpoint = await createTestServer();
  const inboxId = createInboxId();
  const socket = connect(`${endpoint}/?inboxId=${inboxId}`);
  await opens(socket);
  const closed = closes(socket);
  socket.close();
  await closed;

  const replacement = connect(`${endpoint}/?inboxId=${inboxId}`);
  await opens(replacement);
});

test("production bootstrap removes the WebSocket handler during Fastify shutdown", async () => {
  const originalListen = fastify.listen;
  const originalLog = console.log;
  let listened = false;
  fastify.listen = (async () => {
    listened = true;
    return "http://127.0.0.1:0";
  }) as typeof fastify.listen;
  console.log = () => undefined;

  try {
    await startServer();
    assert.equal(listened, true);
    assert.equal(fastify.server.listenerCount("upgrade"), 1);

    await fastify.close();

    assert.equal(fastify.server.listenerCount("upgrade"), 0);
  } finally {
    fastify.listen = originalListen;
    console.log = originalLog;
    fastify.server.removeAllListeners("upgrade");
  }
});
