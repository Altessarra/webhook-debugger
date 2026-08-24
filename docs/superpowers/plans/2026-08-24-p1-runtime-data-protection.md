# P1 Runtime and Data Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded abuse controls, SQLite retention and cursor pagination, WebSocket lifecycle protection, safe production errors and headers, and default-masked sensitive header display without changing the secret-by-link model.

**Architecture:** Keep the current single-instance Fastify/SQLite architecture. Add small runtime utilities for bounded environment parsing and fixed-window limits, extend the existing database layer with cursor-based queries and explicit cleanup, and keep WebSocket state in the server process with bounded maps and timers. Apply the same route policies at the existing handlers and update the client only for paginated history and header reveal.

**Tech Stack:** Node.js 22, TypeScript, Fastify 5, `ws`, better-sqlite3, React 19, existing `node:test`/`tsx` tests.

**Spec:** `docs/superpowers/specs/2026-08-24-p1-runtime-data-protection-design.md`

## Global Constraints

- Keep secret-by-link inbox access; do not add accounts or external infrastructure.
- Preserve webhook ingestion, request history, WebSocket updates, replay, manual send, JSON inspection, and schema inference.
- Use in-process controls suitable for the current single-instance SQLite architecture.
- All operational limits are environment-configurable through bounded parsing.
- The pagination hard cap is 100 items; the default page size is 50.
- Retention defaults to 168 hours and runs every 15 minutes.
- WebSocket heartbeat defaults to 30 seconds and idle/liveness cutoff to 90 seconds.
- Manual send and replay have separate default limits of 10 requests/minute/IP.
- Do not modify Dockerfile, docker-compose.yml, or add `.dockerignore` in this plan.
- Preserve the existing uncommitted P0 changes; stage only files belonging to the current task when committing.

---

### Task 1: Add bounded runtime configuration and deterministic rate limiting

**Files:**
- Create: `server/src/runtimeConfig.ts`
- Create: `server/src/rateLimit.ts`
- Create: `server/src/rateLimit.test.ts`

**Interfaces:**
- `runtimeConfig.ts` exports bounded values for all runtime limits, including `rateLimitWindowMs`, route limits, `maxRateLimitKeys`, `historyDefaultPageSize`, `requestRetentionHours`, `retentionCleanupIntervalMs`, `maxRequestsPerInbox`, `wsMaxConnectionsPerIp`, `wsHeartbeatIntervalMs`, `wsIdleTimeoutMs`, and `wsMaxPayloadBytes`.
- `rateLimit.ts` exports:

```ts
type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number;
};

class FixedWindowLimiter {
  constructor(options: {
    limit: number;
    windowMs: number;
    maxKeys: number;
    now?: () => number;
  });
  check(key: string): RateLimitDecision;
}
```

- `rateLimit.test.ts` uses an injected clock and does not depend on wall time.

- [ ] **Step 1: Write failing limiter tests.** Cover first request allowed, limit exhaustion, deterministic `Retry-After` at 59.1 seconds remaining, reset at the next window, expired-key cleanup, and bounded-key eviction.

- [ ] **Step 2: Run the focused tests and verify the expected failures.**

Run:

```text
cd server
npx tsx --test src/rateLimit.test.ts
```

Expected: failures because `runtimeConfig.ts` and `rateLimit.ts` do not yet exist.

- [ ] **Step 3: Implement bounded parsing.** Parse positive integers with explicit minimum and maximum values; use the documented defaults when values are missing, malformed, zero, negative, fractional, or outside bounds. Keep the hard history cap at 100 in code.

- [ ] **Step 4: Implement the fixed-window limiter.** Key counters by policy key, calculate `retryAfterSeconds` as `max(1, ceil((windowEnd - now) / 1000))`, remove expired keys before admitting a new key, and refuse new keys when `maxKeys` is reached without growing an unbounded map.

- [ ] **Step 5: Run the focused tests and verify they pass.**

Run:

```text
cd server
npx tsx --test src/rateLimit.test.ts
```

- [ ] **Step 6: Commit only the runtime configuration and limiter files.**

```text
git add server/src/runtimeConfig.ts server/src/rateLimit.ts server/src/rateLimit.test.ts
git commit -m "feat: add bounded runtime limits"
```

### Task 2: Add SQLite cursor pagination, quota eviction, and retention cleanup

**Files:**
- Modify: `server/src/db.ts`
- Create: `server/src/db.test.ts`

**Interfaces:**
- Add `RequestCursor = { createdAt: number; id: string }` and opaque base64url cursor encode/decode helpers.
- Replace the unbounded history helper with:

```ts
getRequestsForInbox(
  inboxId: string,
  options: { limit: number; cursor?: RequestCursor },
): { requests: CapturedRow[]; nextCursor: string | null }
```

- Add:

```ts
pruneInboxRequests(inboxId: string, maxRequests: number): number;
deleteExpiredRequests(cutoffMs: number): number;
```

- The query orders by `created_at DESC, id DESC`, fetches `limit + 1`, and returns a cursor only when another row exists.

- [ ] **Step 1: Write failing database tests using an isolated temporary DATA_DIR.** Cover stable ordering for equal timestamps, default-limit behavior supplied by the caller, cursor continuation without duplicates, hard-cap enforcement at 100, oldest-row eviction, and deletion of rows older than the cutoff while retaining newer rows.

- [ ] **Step 2: Run the database tests and verify the expected failures.**

Run:

```text
cd server
npx tsx --test src/db.test.ts
```

- [ ] **Step 3: Add the composite request index and cursor query.** Keep all SQL parameterized and use a transaction for quota eviction.

- [ ] **Step 4: Implement cleanup and quota eviction.** Retain the newest `maxRequests` rows per inbox, delete expired rows by `created_at`, and return deleted-row counts for observability/tests.

- [ ] **Step 5: Run the database tests and verify they pass.**

- [ ] **Step 6: Commit only the database changes and tests.**

```text
git add server/src/db.ts server/src/db.test.ts
git commit -m "feat: bound request history storage"
```

### Task 3: Apply route limits, periodic cleanup, and paginated history

**Files:**
- Modify: `server/src/index.ts`
- Create: `server/src/runtimeRoutes.test.ts`
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/RequestHistory.tsx`
- Modify: `client/src/types/webhook.ts`
- Create: `client/src/utils/requestPagination.ts`
- Create: `client/tests/requestPagination.test.ts`

**Interfaces:**
- Add the route policy keys `inbox-create`, `webhook-ingest`, `history-read`, `manual-send`, and `replay`.
- Use `request.ip` for IP keys and the inbox ID for ingestion/history keys.
- Return `429` with `Retry-After` and `{ error: "Rate limit exceeded" }` when a policy rejects a request.
- History responses use `{ requests, nextCursor }`; the client appends older pages and prevents duplicate IDs.

- [ ] **Step 1: Write failing client pagination tests.** Cover appending a page, preserving newest-first order, deduplicating a repeated cursor boundary, and stopping when `nextCursor` is null.

- [ ] **Step 2: Run the client utility test and verify it fails.**

Run:

```text
server/node_modules/.bin/tsx --test client/tests/requestPagination.test.ts
```

- [ ] **Step 3: Implement the client pagination helper and “Load older” state.** Keep the initial page at 50, send the opaque cursor returned by the API, and preserve the existing live WebSocket prepend behavior.

- [ ] **Step 4: Make the Fastify instance testable without starting a listener.** Export the configured Fastify instance and a listener/bootstrap function from `index.ts`; only invoke the bootstrap when the module is run as the production entry point. Add `server/src/runtimeRoutes.test.ts` using `fastify.inject` with deterministic limiter clocks and test-only low limits. Cover inbox creation, webhook ingestion, history, manual send, and replay limits with exact `Retry-After` values, plus malformed/invalid inbox history requests with stable 4xx responses.

- [ ] **Step 5: Apply the limiter before database reads, inserts, or outbound work.** Do not rate-limit WebSocket broadcasts themselves; rate-limit the incoming webhook route and history API.

- [ ] **Step 6: Schedule explicit retention cleanup.** Run cleanup once after startup, then on `retentionCleanupIntervalMs`; call `.unref()` on the timer and log the number of deleted rows without logging payloads.

- [ ] **Step 7: Prune the inbox after each successful capture.** Evict oldest rows beyond `maxRequestsPerInbox` while keeping the newly captured request available for the response and WebSocket event.

- [ ] **Step 8: Run server and client focused tests and verify they pass.**

- [ ] **Step 9: Commit route, client pagination, and cleanup changes.**

```text
git add server/src/index.ts server/src/runtimeRoutes.test.ts client/src/App.tsx client/src/components/RequestHistory.tsx client/src/types/webhook.ts client/src/utils/requestPagination.ts client/tests/requestPagination.test.ts
git commit -m "feat: add request limits and pagination"
```

### Task 4: Harden WebSocket lifecycle and subscription controls

**Files:**
- Modify: `server/src/index.ts`
- Create: `server/src/websocketSecurity.test.ts`

**Interfaces:**
- WebSocket configuration consumes `allowedOrigin`, `wsMaxConnectionsPerIp`, `wsHeartbeatIntervalMs`, `wsIdleTimeoutMs`, and `wsMaxPayloadBytes`.
- The subscription path is `/` with `?inboxId=<id>`.
- The server accepts a matching configured origin or a missing origin for non-browser clients; mismatched browser origins are rejected.
- Export `attachWebSocketServer(httpServer)` and return a cleanup function so tests can attach to an ephemeral HTTP server and close all heartbeat timers and sockets.

- [ ] **Step 1: Write failing controlled WebSocket tests.** Cover wrong path, mismatched origin, unknown inbox, per-IP connection cap, message payload cap, client-message policy close, heartbeat pong handling, idle/liveness termination, subscriber cleanup, and counter release on close.

- [ ] **Step 2: Run the WebSocket tests and verify the expected failures.**

Run:

```text
cd server
npx tsx --test src/websocketSecurity.test.ts
```

- [ ] **Step 3: Extract the upgrade handler into `attachWebSocketServer(httpServer)` and restrict upgrades.** Validate path, origin, and inbox before subscribing; reject invalid connections before adding them to `inboxSubscribers`.

- [ ] **Step 4: Configure `maxPayload` and reject client messages.** The product is server-push only; close policy-violating messages instead of parsing them.

- [ ] **Step 5: Add heartbeat and liveness timers.** Ping every 30 seconds, require a pong before the next cycle, and terminate sockets that exceed the 90-second liveness cutoff. Ensure timers are cleared on shutdown and tests do not leave open handles.

- [ ] **Step 6: Implement per-IP connection accounting and complete cleanup.** Decrement counters on every close/error path and delete empty subscriber sets.

- [ ] **Step 7: Run the WebSocket tests and the existing live-update smoke test.**

- [ ] **Step 8: Commit only WebSocket changes and tests.**

```text
git add server/src/index.ts server/src/websocketSecurity.test.ts
git commit -m "feat: harden websocket subscriptions"
```

### Task 5: Add safe production errors and browser security headers

**Files:**
- Modify: `server/src/index.ts`
- Create: `server/src/securityHeaders.test.ts`

**Interfaces:**
- Add one Fastify error handler for stable 5xx responses.
- Add an `onSend` hook that sets the approved security headers on API, webhook, WebSocket-upgrade responses where applicable, and static frontend responses.
- Add bounded `ENABLE_HSTS` configuration; emit `Strict-Transport-Security` only when true.
- Reuse the exported Fastify instance and non-listening bootstrap seam from Task 3 so injection tests do not bind port 3000 or call `process.exit`.

- [ ] **Step 1: Write failing Fastify injection tests.** Assert malformed API input returns a stable 4xx/5xx body without stack/path details, normal 404s preserve their intended response, required security headers exist, and HSTS is absent by default and present only when explicitly enabled.

- [ ] **Step 2: Run the header/error tests and verify the expected failures.**

- [ ] **Step 3: Register the production error handler.** Log the detailed error with the request logger, return `{ error: "Internal server error" }` for unexpected 5xx responses, and avoid returning exception messages.

- [ ] **Step 4: Register the `onSend` security-header hook.** Use the approved CSP with `connect-src 'self' ws: wss:` and do not emit HSTS unless the explicit HTTPS flag is enabled.

- [ ] **Step 5: Run the tests and verify they pass.**

- [ ] **Step 6: Commit only error/header changes and tests.**

```text
git add server/src/index.ts server/src/securityHeaders.test.ts
git commit -m "feat: add production error and security headers"
```

### Task 6: Mask sensitive captured headers in the client

**Files:**
- Create: `client/src/utils/sensitiveHeaders.ts`
- Create: `client/src/utils/sensitiveHeaders.test.ts`
- Modify: `client/src/App.tsx`
- Create: `client/src/components/SensitiveHeadersViewer.tsx`

**Interfaces:**
- `maskSensitiveHeaders(value: string, revealed: boolean): string` preserves valid JSON shape and replaces sensitive values with `[REDACTED]` unless revealed.
- `isSensitiveHeader(name: string): boolean` performs case-insensitive matching for authorization, cookie, API-key, access-token, Stripe-signature, and common webhook-signature names.

- [ ] **Step 1: Write failing utility tests.** Cover case-insensitive names, masking only values, preserving ordinary headers and malformed raw text, and returning the original values when reveal is enabled.

- [ ] **Step 2: Run the utility tests and verify the expected failures.**

- [ ] **Step 3: Implement the masking utility.** Do not mutate stored request state; derive a display string from the selected request.

- [ ] **Step 4: Add an explicit reveal/hide control to the headers detail view.** Keep header names and ordinary values visible; label the masked state clearly.

- [ ] **Step 5: Run client tests, typecheck, and lint.**

- [ ] **Step 6: Commit only the sensitive-header display changes and tests.**

```text
git add client/src/utils/sensitiveHeaders.ts client/src/utils/sensitiveHeaders.test.ts client/src/App.tsx client/src/components/SensitiveHeadersViewer.tsx
git commit -m "feat: mask sensitive captured headers"
```

### Task 7: Complete runtime verification and handoff

**Files:**
- Modify only test fixtures or documentation if verification exposes a runtime-specific defect.

- [ ] **Step 1: Run the full server P1 suite.**

```text
cd server
npx tsx --test src/*.test.ts
npm run build
```

- [ ] **Step 2: Run client checks.**

```text
cd client
npx tsc -b
npm run lint
```

- [ ] **Step 3: Run both production dependency audits.**

```text
cd server
npm audit --omit=dev
cd ../client
npm audit --omit=dev
```

- [ ] **Step 4: Run `git diff --check`.**

- [ ] **Step 5: Start the built server with explicit P1 environment overrides and smoke-test:** inbox creation, 429 responses and exact `Retry-After`, webhook ingestion, paginated history, quota eviction, retention cleanup, authorized replay/manual-send limits, WebSocket origin/inbox rejection, heartbeat/live update, generic error responses, and security headers.

- [ ] **Step 6: Verify no deployment files were changed.** Confirm `Dockerfile`, `docker-compose.yml`, and `.dockerignore` remain outside this sub-project.

- [ ] **Step 7: Report residual risks and explicitly defer the deployment-hardening sub-project.**
