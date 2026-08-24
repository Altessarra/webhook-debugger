import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { buildServer } from "./index";

const apps: Array<ReturnType<typeof buildServer>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createTestApp(enableHsts = false) {
  const app = buildServer({ enableHsts });
  apps.push(app);
  return app;
}

const securityHeaders = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function expectSecurityHeaders(headers: Record<string, unknown>) {
  for (const [name, value] of Object.entries(securityHeaders)) {
    assert.equal(headers[name], value);
  }
}

test("keeps intentional client errors and not-found responses unchanged", async () => {
  const app = createTestApp();

  const malformed = await app.inject({
    method: "POST",
    url: "/api/send",
    payload: { method: "POST", targetUrl: "", headers: "{}", body: "" },
  });
  assert.equal(malformed.statusCode, 400);
  assert.deepEqual(malformed.json(), {
    success: false,
    error: "Destination URL is required",
  });

  const missing = await app.inject({ method: "GET", url: "/api/missing" });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: "Not found" });
});

test("returns a stable, detail-free body for unexpected server errors", async () => {
  const app = createTestApp();
  app.get("/test/unexpected-error", () => {
    throw new Error("sensitive failure details");
  });

  const response = await app.inject({ method: "GET", url: "/test/unexpected-error" });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: "Internal server error" });
  assert.equal(response.body.includes("sensitive failure details"), false);
  assert.equal(response.body.includes("/test/unexpected-error"), false);
  assert.equal(response.body.includes("stack"), false);
});

test("adds the approved headers to API, webhook, and frontend responses without HSTS by default", async () => {
  const app = createTestApp();
  app.get("/test/frontend", () => "frontend");

  const api = await app.inject({ method: "POST", url: "/api/inboxes" });
  const inbox = api.json() as { id: string };
  const webhook = await app.inject({
    method: "POST",
    url: `/i/${inbox.id}`,
    payload: { received: true },
  });
  const frontend = await app.inject({ method: "GET", url: "/test/frontend" });

  for (const response of [api, webhook, frontend]) {
    expectSecurityHeaders(response.headers);
    assert.equal(response.headers["strict-transport-security"], undefined);
  }
});

test("adds HSTS only when explicitly enabled through the server configuration seam", async () => {
  const app = createTestApp(true);

  const response = await app.inject({ method: "POST", url: "/api/inboxes" });

  expectSecurityHeaders(response.headers);
  assert.equal(response.headers["strict-transport-security"], "max-age=31536000; includeSubDomains");
});
