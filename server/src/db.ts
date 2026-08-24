import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export type CapturedRow = {
  id: string;
  inbox_id: string;
  method: string;
  path: string;
  headers: string;
  body: string | null;
  query: string;
  created_at: number;
};

export type RequestCursor = {
  createdAt: number;
  id: string;
};

const dataDir = process.env.DATA_DIR || process.cwd();
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "webhook-debugger.db");
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS inboxes (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    inbox_id TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    headers TEXT NOT NULL,
    body TEXT,
    query TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (inbox_id) REFERENCES inboxes(id)
  );

  CREATE INDEX IF NOT EXISTS idx_requests_inbox_created_at_id
  ON requests(inbox_id, created_at DESC, id DESC);
`);

const MAX_HISTORY_PAGE_SIZE = 100;

export function encodeRequestCursor(cursor: RequestCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeRequestCursor(cursor: string) {
  const parsed = JSON.parse(
    Buffer.from(cursor, "base64url").toString("utf8"),
  ) as Partial<RequestCursor>;

  if (
    typeof parsed.createdAt !== "number" ||
    !Number.isSafeInteger(parsed.createdAt) ||
    typeof parsed.id !== "string" ||
    !parsed.id
  ) {
    throw new Error("Invalid request cursor");
  }

  return {
    createdAt: parsed.createdAt,
    id: parsed.id,
  } satisfies RequestCursor;
}

export function createInbox(id: string) {
  const stmt = db.prepare("INSERT INTO inboxes (id, created_at) VALUES (?, ?)");
  stmt.run(id, Date.now());
}

export function getInbox(id: string) {
  return db.prepare("SELECT * FROM inboxes WHERE id = ?").get(id);
}

export function checkDatabaseHealth() {
  db.prepare("SELECT 1").get();
}

export function insertRequest(req: {
  id: string;
  inboxId: string;
  method: string;
  path: string;
  headers: string;
  body: string | null;
  query: string;
  createdAt?: number;
}) {
  const stmt = db.prepare(`
    INSERT INTO requests (id, inbox_id, method, path, headers, body, query, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    req.id,
    req.inboxId,
    req.method,
    req.path,
    req.headers,
    req.body,
    req.query,
    req.createdAt ?? Date.now(),
  );
}

type RequestPage = {
  requests: CapturedRow[];
  nextCursor: string | null;
};

export function getRequestsForInbox(
  inboxId: string,
  options: { limit: number; cursor?: RequestCursor },
): RequestPage;
export function getRequestsForInbox(
  inboxId: string,
  options: { limit: number; cursor?: RequestCursor },
) {
  const limit = Math.max(1, Math.min(MAX_HISTORY_PAGE_SIZE, options.limit));
  const limitPlusOne = limit + 1;
  let rows: CapturedRow[];

  if (options.cursor) {
    rows = db
      .prepare(
        `
          SELECT *
          FROM requests
          WHERE inbox_id = ?
            AND (
              created_at < ?
              OR (created_at = ? AND id < ?)
            )
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(
        inboxId,
        options.cursor.createdAt,
        options.cursor.createdAt,
        options.cursor.id,
        limitPlusOne,
      ) as CapturedRow[];
  } else {
    rows = db
      .prepare(
        `
          SELECT *
          FROM requests
          WHERE inbox_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(inboxId, limitPlusOne) as CapturedRow[];
  }

  const hasMore = rows.length > limit;
  const requests = hasMore ? rows.slice(0, limit) : rows;
  const lastRequest = requests.length > 0 ? requests[requests.length - 1] : undefined;

  return {
    requests,
    nextCursor:
      hasMore && lastRequest
        ? encodeRequestCursor({
            createdAt: lastRequest.created_at,
            id: lastRequest.id,
          })
        : null,
  } satisfies RequestPage;
}

const pruneInboxRequestsTransaction = db.transaction(
  (inboxId: string, maxRequests: number) =>
    db
      .prepare(
        `
          DELETE FROM requests
          WHERE inbox_id = ?
            AND id IN (
              SELECT id
              FROM requests
              WHERE inbox_id = ?
              ORDER BY created_at DESC, id DESC
              LIMIT -1 OFFSET ?
            )
        `,
      )
      .run(inboxId, inboxId, maxRequests).changes,
);

export function pruneInboxRequests(inboxId: string, maxRequests: number) {
  return pruneInboxRequestsTransaction(
    inboxId,
    Math.max(0, Math.trunc(maxRequests)),
  );
}

export function deleteExpiredRequests(cutoffMs: number) {
  return db
    .prepare("DELETE FROM requests WHERE created_at < ?")
    .run(cutoffMs).changes;
}

export function getRequestById(id: string) {
  return db.prepare("SELECT * FROM requests WHERE id = ?").get(id) as
    | CapturedRow
    | undefined;
}
