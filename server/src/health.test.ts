import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { db } from "./db";
import { buildServer } from "./index";

const apps: Array<ReturnType<typeof buildServer>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createTestApp() {
  const app = buildServer();
  apps.push(app);
  return app;
}

test("returns ok when the database health probe succeeds", async () => {
  const app = createTestApp();

  const response = await app.inject({
    method: "GET",
    url: "/health",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
});

test("returns a stable unhealthy response when the database health probe fails", async () => {
  const app = createTestApp();
  const originalPrepare = db.prepare.bind(db);

  db.prepare = (() => {
    throw new Error("SQLITE_CANTOPEN: C:\\sensitive\\webhook-debugger.db");
  }) as typeof db.prepare;

  try {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { status: "unhealthy" });
    assert.equal(
      response.body.includes("SQLITE_CANTOPEN"),
      false,
    );
    assert.equal(
      response.body.includes("C:\\sensitive\\webhook-debugger.db"),
      false,
    );
  } finally {
    db.prepare = originalPrepare as typeof db.prepare;
  }
});
