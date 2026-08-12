import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'webhook-debugger.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

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

  CREATE INDEX IF NOT EXISTS idx_requests_inbox_id ON requests(inbox_id);
`);

export function createInbox(id: string) {
  const stmt = db.prepare('INSERT INTO inboxes (id, created_at) VALUES (?, ?)');
  stmt.run(id, Date.now());
}

export function getInbox(id: string) {
  return db.prepare('SELECT * FROM inboxes WHERE id = ?').get(id);
}

export function insertRequest(req: {
  id: string;
  inboxId: string;
  method: string;
  path: string;
  headers: string;
  body: string | null;
  query: string;
}) {
  const stmt = db.prepare(`
    INSERT INTO requests (id, inbox_id, method, path, headers, body, query, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(req.id, req.inboxId, req.method, req.path, req.headers, req.body, req.query, Date.now());
}

export function getRequestsForInbox(inboxId: string) {
  return db.prepare('SELECT * FROM requests WHERE inbox_id = ? ORDER BY created_at DESC').all(inboxId);
}

export function getRequestById(id: string) {
  return db.prepare('SELECT * FROM requests WHERE id = ?').get(id) as
    | {
        id: string;
        inbox_id: string;
        method: string;
        path: string;
        headers: string;
        body: string | null;
        query: string;
        created_at: number;
      }
    | undefined;
}