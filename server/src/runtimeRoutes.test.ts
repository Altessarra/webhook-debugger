import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { buildServer } from "./index";

let currentTime = 1_000;
const apps: Array<ReturnType<typeof buildServer>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createTestApp() {
  currentTime = 1_000;
  const app = buildServer({
    now: () => currentTime,
    rateLimits: {
      "inbox-create": 1,
      "webhook-ingest": 1,
      "history-read": 1,
      "manual-send": 1,
      replay: 1,
    },
  });
  apps.push(app);
  return app;
}

const expectRateLimit = (response: { statusCode: number; headers: Record<string, unknown>; json: () => unknown }) => {
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers["retry-after"], "60");
  assert.deepEqual(response.json(), { error: "Rate limit exceeded" });
};

test("limits inbox creation by client IP before creating another inbox", async () => {
  const app = createTestApp();

  assert.equal((await app.inject({ method: "POST", url: "/api/inboxes" })).statusCode, 200);
  expectRateLimit(await app.inject({ method: "POST", url: "/api/inboxes" }));
});

test("limits webhook ingestion by inbox before another capture", async () => {
  const app = createTestApp();
  const inbox = (await app.inject({ method: "POST", url: "/api/inboxes" })).json() as { id: string };

  assert.equal(
    (await app.inject({ method: "POST", url: `/i/${inbox.id}`, payload: { accepted: true } })).statusCode,
    200,
  );
  expectRateLimit(
    await app.inject({ method: "POST", url: `/i/${inbox.id}`, payload: { accepted: true } }),
  );
});

test("limits inbox history reads and returns malformed cursors as stable client errors", async () => {
  const malformedApp = createTestApp();
  const malformedInbox = (await malformedApp.inject({ method: "POST", url: "/api/inboxes" })).json() as { id: string };

  const malformed = await malformedApp.inject({
    method: "GET",
    url: `/api/inboxes/${malformedInbox.id}/requests?cursor=not-a-cursor`,
  });
  assert.equal(malformed.statusCode, 400);
  assert.deepEqual(malformed.json(), { error: "Invalid request cursor" });

  const app = createTestApp();
  const inbox = (await app.inject({ method: "POST", url: "/api/inboxes" })).json() as { id: string };
  assert.equal(
    (await app.inject({ method: "GET", url: `/api/inboxes/${inbox.id}/requests` })).statusCode,
    200,
  );
  expectRateLimit(
    await app.inject({ method: "GET", url: `/api/inboxes/${inbox.id}/requests` }),
  );

  const missingApp = createTestApp();
  const missing = await missingApp.inject({ method: "GET", url: "/api/inboxes/does-not-exist/requests" });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: "Inbox not found" });
});

test("limits manual sends before outbound work", async () => {
  const app = createTestApp();
  const payload = { method: "POST", targetUrl: "not-a-url", headers: "{}", body: "" };

  assert.equal((await app.inject({ method: "POST", url: "/api/send", payload })).statusCode, 400);
  expectRateLimit(await app.inject({ method: "POST", url: "/api/send", payload }));
});

test("limits replays separately from manual sends before outbound work", async () => {
  const app = createTestApp();
  const payload = { inboxId: "missing", requestId: "missing", targetUrl: "not-a-url" };

  assert.equal((await app.inject({ method: "POST", url: "/api/replay", payload })).statusCode, 404);
  expectRateLimit(await app.inject({ method: "POST", url: "/api/replay", payload }));
});
