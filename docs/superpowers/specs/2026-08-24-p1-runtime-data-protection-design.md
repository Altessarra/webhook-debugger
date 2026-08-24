# Webhook Debugger P1 Runtime and Data Protection Design

**Date:** 2026-08-24  
**Status:** Approved for implementation  
**Scope:** P1 runtime/data protection only

## Goal

Harden the single-instance Webhook Debugger runtime against abusive request volume, unbounded SQLite history, uncontrolled WebSocket usage, raw production errors, missing browser security headers, and accidental display of captured credentials while preserving the secret-by-link model and existing debugging workflows.

Deployment hardening is intentionally excluded from this design and will be implemented and verified as a separate sub-project.

## Constraints

- Keep secret-by-link inbox access; do not add accounts or external infrastructure.
- Preserve webhook ingestion, request history, WebSocket updates, replay, manual send, JSON inspection, and schema inference.
- Use in-process controls suitable for the current single-instance SQLite architecture.
- All operational limits are environment-configurable through bounded parsing.
- The pagination hard cap is 100 items; the default page size is 50.
- Do not silently discard newly captured requests; when an inbox quota is reached, retain the newest requests and evict the oldest retained rows.

## Runtime limits

| Control | Default | Safe bounds / behavior |
|---|---:|---|
| Inbox creation | 10/minute/IP | Fixed one-minute window; `429` with deterministic `Retry-After` |
| Webhook ingestion | 120/minute/inbox | Fixed one-minute window; `429` with deterministic `Retry-After` |
| History reads | 30/minute/inbox | Fixed one-minute window; `429` with deterministic `Retry-After` |
| Manual send | 10/minute/IP | Separate from replay; fixed one-minute window |
| Replay | 10/minute/IP | Separate from manual send; fixed one-minute window |
| WebSocket connections | 10/IP | Concurrent cap; rejected connections close with policy code |
| Retained requests/inbox | 1,000 | Newest rows retained; oldest rows evicted |
| Retention age | 168 hours | Periodic cleanup every 15 minutes; bounded to 1 hour–365 days |
| History default page | 50 | Environment-adjustable within 1–100 |
| History hard page cap | 100 | Non-configurable code safety cap |
| WebSocket heartbeat | 30 seconds | Bounded environment override |
| WebSocket idle/liveness cutoff | 90 seconds | Must remain greater than heartbeat interval |
| WebSocket message payload | 64 KiB | Bounded environment override |

The rate limiter uses fixed windows keyed by route policy plus the relevant IP or inbox ID. The response calculates `Retry-After` from the exact end of the active window: `max(1, ceil((windowEnd - now) / 1000))`. Limiter state has a bounded key count and expires old buckets to prevent the limiter itself becoming a memory-exhaustion vector.

## Components and data flow

### Rate limiting

Create a small internal limiter utility with:

- bounded integer environment parsing;
- route-specific policies;
- injectable clock for deterministic tests;
- fixed-window counters;
- `Retry-After` calculation;
- bounded key cleanup;
- response helpers for `429` handling.

Apply policies before expensive work:

```text
request
→ identify remote IP / inbox key
→ consume route policy
→ reject with 429 + Retry-After or continue
```

The server will use Fastify’s remote address as the client IP because the current application does not declare trusted proxies. Proxy trust is not introduced in this pass.

### SQLite retention and pagination

Extend the request index to `(inbox_id, created_at DESC, id DESC)`.

The history API becomes:

```text
GET /api/inboxes/:id/requests?limit=50&cursor=<opaque-cursor>
```

The cursor encodes the last `(created_at, id)` pair so requests sharing a timestamp do not duplicate or disappear between pages. The response is:

```json
{
  "requests": [],
  "nextCursor": "..."
}
```

The frontend loads the first page and offers an explicit “Load older” action when `nextCursor` exists.

Retention has two protections:

1. A per-inbox maximum retains only the newest configured number of rows.
2. A periodic cleanup job deletes rows older than the configured retention age.

The cleanup job runs once at startup and then on a bounded interval. It is unref’d so it does not prevent graceful process exit. Cleanup and quota eviction use parameterized SQL and transactions where multiple statements must be coordinated.

### WebSocket controls

WebSocket upgrades are accepted only for the root WebSocket path. When an `Origin` header is present, it must exactly match the configured application origin. The inbox must exist before subscription, and the per-IP concurrent connection cap must be available.

The server configures a bounded message payload. Client messages are not part of the product protocol; receiving one closes the socket with a policy-violation code.

Liveness uses:

- a 30-second server heartbeat ping;
- a pong flag reset on each ping cycle;
- termination when the client fails to answer within the next heartbeat cycle;
- a 90-second idle/liveness cutoff tested with a fake clock or controlled socket.

Closed sockets decrement the IP counter and are removed from inbox subscriber sets. Empty subscriber sets are deleted from the map.

### Errors and security headers

Add a production error handler that:

- logs the detailed error server-side through the request logger;
- returns stable generic messages for 5xx responses;
- preserves intentionally generated 4xx responses;
- does not expose stack traces, absolute paths, or raw exception messages.

Add response headers:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

HSTS is emitted only when an explicit HTTPS deployment flag is enabled. The Docker Compose HTTP development configuration must not receive HSTS by default.

### Sensitive header display

Captured request headers remain available for debugging, but the UI masks sensitive values by default. The header view gets an explicit reveal control for the current request. Masking is display-only in this sub-project; replay already strips credential-bearing headers at the server boundary.

Sensitive display names include `authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `x-access-token`, Stripe signature headers, and common webhook signature headers. Header names and ordinary content headers remain visible.

## Testing strategy

Add focused tests before implementation for:

- each route-specific rate-limit policy;
- deterministic `Retry-After` values at window boundaries;
- limiter key expiry and bounded-key behavior;
- default page size, hard cap, cursor ordering, and next-cursor generation;
- oldest-row eviction and periodic retention cleanup;
- WebSocket origin rejection, unknown-inbox rejection, per-IP cap, payload cap, heartbeat, idle termination, and cleanup;
- generic 5xx responses with detailed server-side logging;
- security headers and conditional HSTS;
- sensitive-header masking and explicit reveal behavior.

Existing P0 regression tests, server build, client typecheck/lint, dependency audits, ingestion/history/WebSocket smoke tests, and `git diff --check` remain required gates.

## Explicitly deferred

The following remain deployment-hardening work for the second sub-project:

- `.dockerignore`;
- `npm ci` Docker reproducibility;
- non-root runtime image;
- removal of build toolchains from the final image;
- Docker healthcheck and container filesystem hardening.

