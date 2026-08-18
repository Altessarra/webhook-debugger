# Webhook Debugger

Webhook debugging is usually a visibility problem. A provider sends a request, but the useful details are hidden behind a third-party dashboard, incomplete logs, or an error that only says the delivery failed. Without seeing the actual payload, headers, query parameters, and timing, debugging becomes guesswork.

Webhook Debugger gives developers a temporary inbox where they can send a webhook and inspect exactly what arrived.

## What it does

- Creates unique webhook inboxes with shareable endpoints.
- Captures incoming HTTP requests, including method, path, headers, query parameters, and body.
- Displays new requests in the UI in real time through WebSocket events.
- Persists inboxes and captured requests in SQLite so history survives restarts.
- Renders JSON payloads as an expandable tree and infers a basic schema from valid JSON.
- Replays captured requests to another endpoint for debugging delivery behavior.
- Sends custom test requests with configurable method, headers, and body.
- Includes validation and private-network blocking for server-side outbound requests.

## Architecture

```text
Webhook provider or curl
          |
          v
Fastify receives /i/:inboxId
          |
          +--> SQLite persists the request
          |
          +--> WebSocket broadcasts new_request
                                      |
                                      v
                              React updates the UI
```

The browser loads request history through `GET /api/inboxes/:id/requests`. While the inbox is open, the fronxtend connects to the WebSocket server with the inbox ID. Each incoming webhook is written to SQLite and broadcast to the matching subscribers, so the request list updates without a refresh.

## One hard technical decision: WebSocket over polling

I chose WebSockets for live request updates because the primary interaction is event-driven: the UI should react when a webhook arrives, not repeatedly ask whether one arrived. Polling would add recurring requests and introduce a delay based on the polling interval. A WebSocket connection keeps one open channel per active inbox and lets the server push only the new request. The tradeoff is connection lifecycle handling—connect, disconnect, cleanup, and reconnection behavior—but that complexity is appropriate for a debugger whose main value is immediate visibility.

## Why Docker

The service is containerized so the Fastify server, SQLite runtime, WebSocket server, and built React assets run in the same predictable environment. The Docker build compiles the frontend, compiles the backend, then copies the frontend bundle into the backend image for Fastify to serve. SQLite data is mounted separately in Docker Compose, which keeps local data persistent while keeping the Render deployment configuration small and repeatable.

## Tech stack

- React 19
- TypeScript
- Vite
- React Router
- Tailwind CSS through the Vite plugin
- Fastify
- WebSocket (`ws`)
- SQLite with `better-sqlite3`
- Docker and Docker Compose
- Render for deployment

## Setup and run locally

Install dependencies in both packages:

```bash
cd server
npm install

cd ../client
npm install
```

Start the backend:

```bash
cd server
npm run dev
```

Start the frontend in a second terminal:

```bash
cd client
npm run dev
```

The Vite development server proxies `/api` and `/i` requests to the Fastify server on port `3000`.

## Live demo

[Open the deployed Webhook Debugger](https://webhook-debugger-6jyk.onrender.com)


