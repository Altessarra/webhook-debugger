# P1B Deployment Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the production Docker image and Compose service with deterministic builds, a non-root read-only runtime, explicit SQLite persistence, and a database-aware `/health` endpoint while preserving P0/P1A behavior.

**Architecture:** Keep the existing single Node/Fastify + SQLite + built React image. Add only the approved `/health` runtime endpoint using the existing database connection; harden the container boundary through a root `.dockerignore`, lockfile-backed multi-stage Docker build, non-root runtime ownership, and Compose filesystem/security settings.

**Tech Stack:** Docker, Docker Compose, Node.js 22 Alpine, npm lockfiles, TypeScript, Fastify, better-sqlite3, existing `node:test`/`tsx` tests.

**Spec:** Approved user brief at `C:\Users\Altessa\.codex\attachments\e8508643-f549-4685-a2d0-f3287e25b95d\pasted-text.txt`.

## Global Constraints

- Work only in the isolated `codex/p1b-deployment-hardening` worktree.
- Keep the secret-by-link architecture and single-instance Node/Fastify/SQLite design.
- Do not modify P0/P1A behavior except the explicitly approved `GET /health` endpoint.
- Do not add accounts, authentication, external infrastructure, reverse proxies, TLS termination, databases, or unrelated features.
- Preserve P0/P1A security, rate-limit, retention, pagination, WebSocket, error/header, HSTS, sensitive-header, and history-loading contracts.
- Do not stage or commit the existing copied P0 context files: `client/src/components/ManualRequestForm.tsx`, `server/src/manualRequest.test.ts`, `server/src/manualRequest.ts`, `server/src/outbound.test.ts`, and `server/src/outbound.ts`.
- Runtime persistent writes use `/app/data`; temporary writes use `/tmp`; the container root filesystem remains read-only.
- The final runtime image must not include compilers, build toolchains, TypeScript, dev dependencies, source, tests, or caches unless runtime behavior requires them.
- Do not bake secrets into Dockerfile, image layers, Compose files, source, or client assets.

---

### Task 1: Add database-aware health endpoint

**Files:**
- Modify: `server/src/index.ts`
- Modify or use: `server/src/db.ts`
- Create: `server/src/health.test.ts`

**Requirements:**
- Add only `GET /health` as the approved runtime behavior addition.
- Execute a lightweight `SELECT 1` through the existing SQLite connection/helper.
- Return exactly `{ status: "ok" }` with HTTP 200 when the query succeeds.
- Return exactly `{ status: "unhealthy" }` with HTTP 503 when the query fails.
- Do not expose SQL errors, paths, filenames, environment values, secrets, or stack traces.
- Keep the endpoint unauthenticated, lightweight, independent of inbox state and ordinary product quotas.
- Add focused tests for healthy and failed database readiness using the existing Fastify injection seam; tests must assert stable, non-sensitive responses.

**TDD steps:**
- [x] Write the failing health tests first.
- [x] Run `npx tsx --test src/health.test.ts` and confirm the expected failure.
- [x] Implement the smallest endpoint/database seam.
- [x] Run the focused test and the server suite.
- [x] Commit only health endpoint/test changes (plus the minimal existing DB helper change if required).

### Task 2: Harden the production Docker image

**Files:**
- Create: `.dockerignore`
- Modify: `Dockerfile`

**Requirements:**
- Exclude VCS metadata, dependencies, build output, coverage/log/temp files, SQLite files, environment/secrets, OS/editor metadata, and safe development-only material from build context.
- Do not exclude manifests, lockfiles, compiler/build configuration, source, or production assets needed by the build.
- Use `npm ci` in both relevant build stages after copying each package manifest and lockfile.
- Compile native dependencies in a builder compatible with the final Alpine runtime.
- Prune production dependencies in the builder and copy only compiled server output, production dependencies, and built frontend assets into the final image.
- Do not install Python/make/g++ or equivalent build tooling in the final stage.
- Create a dedicated non-root app user/group, set ownership for `/app` and `/app/data`, set `DATA_DIR=/app/data`, and switch to the user before `CMD`.
- Add a bounded Node-based Docker healthcheck to `/health`; do not add curl solely for healthchecking.
- Use explicit production defaults without baking secrets.

**Verification steps:**
- [x] Validate the Dockerfile syntax/build configuration.
- [ ] Build the image from a clean context (blocked: Docker engine unavailable).
- [ ] Inspect final image metadata and runtime dependency contents (blocked: Docker engine unavailable).
- [x] Commit only `.dockerignore` and `Dockerfile` changes.

### Task 3: Harden Docker Compose runtime

**Files:**
- Modify: `docker-compose.yml`

**Requirements:**
- Keep one named persistent volume mounted at `/app/data`.
- Set `read_only: true`.
- Mount `/tmp` as writable tmpfs with bounded options.
- Drop all Linux capabilities with `cap_drop: [ALL]`.
- Enable `security_opt: [no-new-privileges:true]`.
- Do not add privileged mode, host networking, host filesystem mounts, devices, Docker socket, proxy, TLS, or unrelated services.
- Keep runtime environment secret-free and explicitly set `DATA_DIR=/app/data`.
- Ensure service startup, SQLite WAL/journal writes, and restart persistence work under these constraints.
- Commit only Compose changes.

**Verification steps:**
- [x] Run `docker compose config`.
- [ ] Start the hardened service with a fresh named volume (blocked: Docker engine unavailable).
- [ ] Verify non-root identity, read-only root, writable `/app/data`, writable `/tmp`, capabilities/security settings, and `/health` (blocked: Docker engine unavailable).
- [ ] Verify persistence across stop/recreate/start (blocked: Docker engine unavailable).
- [x] Commit only `docker-compose.yml` changes.

### Task 4: Full regression and container verification

**Files:**
- Modify only focused test fixtures or documentation if verification exposes a deployment-specific defect.

**Required checks:**
- [x] Full server test suite, server build.
- [x] Full client test suite, client typecheck, lint, production build.
- [x] Server/client production dependency audits.
- [x] `git diff --check`.
- [ ] Clean Docker image build and Compose validation (Compose validation passed; image build blocked: Docker engine unavailable).
- [ ] Container health success and simulated health failure/unhealthy transition (blocked: Docker engine unavailable).
- [ ] Non-root, read-only root, `/app/data`, `/tmp`, capability drop, no-new-privileges, and restart persistence checks (blocked: Docker engine unavailable).
- [x] Runtime smoke checks for WebSocket, history, replay/manual-send P0 behavior, security headers, and default-disabled HSTS (local built-process startup and `/health` smoke passed; container-specific checks blocked).
- [x] Confirm copied P0 context files are not staged or committed and no unrelated files changed.

**Completion:**
- [x] Record verification evidence and any blocked Docker checks explicitly.
- [ ] Run a whole-branch review before handoff.
- [ ] Stop after P1B; do not begin P2 or a new re-audit.
