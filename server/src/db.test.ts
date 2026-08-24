import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { pathToFileURL } from "node:url";

type DbModule = typeof import("./db");

const dbModulePath = path.resolve(__dirname, "db.ts");
let tempDir = "";
let dbModule: DbModule;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "webhook-db-test-"));
  process.env.DATA_DIR = tempDir;

  const moduleUrl = `${pathToFileURL(dbModulePath).href}?case=${Math.random().toString(36).slice(2)}`;
  dbModule = (await import(moduleUrl)) as DbModule;
});

beforeEach(() => {
  dbModule.db.prepare("DELETE FROM requests").run();
  dbModule.db.prepare("DELETE FROM inboxes").run();
});

after(() => {
  dbModule.db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

const insertCapturedRequest = (
  dbModule: DbModule,
  request: {
    id: string;
    inboxId: string;
    createdAt: number;
    method?: string;
    path?: string;
    headers?: string;
    body?: string | null;
    query?: string;
  },
) => {
  dbModule.db
    .prepare(
      `
        INSERT INTO requests (id, inbox_id, method, path, headers, body, query, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      request.id,
      request.inboxId,
      request.method ?? "POST",
      request.path ?? `/requests/${request.id}`,
      request.headers ?? '{"content-type":"application/json"}',
      request.body ?? null,
      request.query ?? "{}",
      request.createdAt,
    );
};

test("orders equal timestamps by id descending and returns a continuation cursor", async () => {
  dbModule.createInbox("inbox-a");
  insertCapturedRequest(dbModule, {
    id: "aaa",
    inboxId: "inbox-a",
    createdAt: 1_000,
  });
  insertCapturedRequest(dbModule, {
    id: "ccc",
    inboxId: "inbox-a",
    createdAt: 1_000,
  });
  insertCapturedRequest(dbModule, {
    id: "bbb",
    inboxId: "inbox-a",
    createdAt: 1_000,
  });

  const firstPage = dbModule.getRequestsForInbox("inbox-a", { limit: 2 });

  assert.deepEqual(
    firstPage.requests.map((request) => request.id),
    ["ccc", "bbb"],
  );
  assert.equal(typeof firstPage.nextCursor, "string");
  const cursor = dbModule.decodeRequestCursor(firstPage.nextCursor!);

  const secondPage = dbModule.getRequestsForInbox("inbox-a", {
    limit: 2,
    cursor,
  });

  assert.deepEqual(
    secondPage.requests.map((request) => request.id),
    ["aaa"],
  );
  assert.equal(secondPage.nextCursor, null);
});

test("uses the caller supplied page size and preserves the captured row shape", async () => {
  dbModule.createInbox("inbox-limit");
  insertCapturedRequest(dbModule, {
    id: "req-1",
    inboxId: "inbox-limit",
    createdAt: 100,
    method: "PATCH",
    path: "/webhook",
    headers: '{"x-test":"1"}',
    body: '{"ok":true}',
    query: '{"page":"1"}',
  });
  insertCapturedRequest(dbModule, {
    id: "req-2",
    inboxId: "inbox-limit",
    createdAt: 200,
  });
  insertCapturedRequest(dbModule, {
    id: "req-3",
    inboxId: "inbox-limit",
    createdAt: 300,
  });

  const page = dbModule.getRequestsForInbox("inbox-limit", { limit: 2 });

  assert.equal(page.requests.length, 2);
  assert.deepEqual(Object.keys(page.requests[0]).sort(), [
    "body",
    "created_at",
    "headers",
    "id",
    "inbox_id",
    "method",
    "path",
    "query",
  ]);
  assert.equal(page.requests[1]?.id, "req-2");
  assert.equal(typeof page.nextCursor, "string");
});

test("caps the page size at 100 even when the caller asks for more", async () => {
  dbModule.createInbox("inbox-cap");
  for (let index = 0; index < 101; index += 1) {
    insertCapturedRequest(dbModule, {
      id: `req-${index.toString().padStart(3, "0")}`,
      inboxId: "inbox-cap",
      createdAt: index,
    });
  }

  const page = dbModule.getRequestsForInbox("inbox-cap", { limit: 150 });

  assert.equal(page.requests.length, 100);
  assert.equal(page.requests[0]?.id, "req-100");
  assert.equal(page.requests[page.requests.length - 1]?.id, "req-001");
  assert.equal(typeof page.nextCursor, "string");
});

test("prunes the oldest rows first and reports the deleted count", async () => {
  dbModule.createInbox("inbox-prune");
  insertCapturedRequest(dbModule, {
    id: "oldest",
    inboxId: "inbox-prune",
    createdAt: 100,
  });
  insertCapturedRequest(dbModule, {
    id: "middle",
    inboxId: "inbox-prune",
    createdAt: 200,
  });
  insertCapturedRequest(dbModule, {
    id: "newest",
    inboxId: "inbox-prune",
    createdAt: 300,
  });

  const deletedCount = dbModule.pruneInboxRequests("inbox-prune", 2);
  const remainingIds = dbModule
    .getRequestsForInbox("inbox-prune", { limit: 10 })
    .requests.map((request) => request.id);

  assert.equal(deletedCount, 1);
  assert.deepEqual(remainingIds, ["newest", "middle"]);
});

test("deletes only requests older than the retention cutoff", async () => {
  dbModule.createInbox("inbox-retention");
  insertCapturedRequest(dbModule, {
    id: "expired",
    inboxId: "inbox-retention",
    createdAt: 1_000,
  });
  insertCapturedRequest(dbModule, {
    id: "fresh",
    inboxId: "inbox-retention",
    createdAt: 2_000,
  });
  dbModule.createInbox("other-inbox");
  insertCapturedRequest(dbModule, {
    id: "other-fresh",
    inboxId: "other-inbox",
    createdAt: 2_500,
  });

  const deletedCount = dbModule.deleteExpiredRequests(1_500);
  const inboxRequests = dbModule.getRequestsForInbox("inbox-retention", {
    limit: 10,
  });
  const otherInboxRequests = dbModule.getRequestsForInbox("other-inbox", {
    limit: 10,
  });

  assert.equal(deletedCount, 1);
  assert.deepEqual(
    inboxRequests.requests.map((request) => request.id),
    ["fresh"],
  );
  assert.deepEqual(
    otherInboxRequests.requests.map((request) => request.id),
    ["other-fresh"],
  );
});
