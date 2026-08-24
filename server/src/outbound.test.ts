import http from "node:http";
import assert from "node:assert/strict";
import test from "node:test";
import {
  createOutboundLimiter,
  executeOutboundRequest,
  executePinnedRequest,
  filterReplayHeaders,
  isOutboundRedirect,
  isRequestOwnedByInbox,
  OutboundResponseTooLargeError,
  OutboundTimeoutError,
  OutboundDestinationError,
  parseReplayInput,
} from "./outbound";
import {
  resolveSafeDestination,
  type ResolvedDestination,
} from "./manualRequest";

function listen(server: http.Server) {
  return new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      resolve(address.port);
    });
  });
}

function close(server: http.Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function localDestination(port: number): ResolvedDestination {
  return {
    destination: new URL(`http://127.0.0.1:${port}/`),
    address: "127.0.0.1",
    family: 4,
  };
}

test("rejects a private address returned by DNS resolution", async () => {
  const result = await resolveSafeDestination(
    "https://public.test/webhook",
    async () => [
      { address: "10.0.0.8", family: 4 },
    ],
  );
  assert.deepEqual(result, {
    error: "Destination resolves to a private or internal address",
  });
});

test("pins the selected public DNS address for the outbound connection", async () => {
  const resolved = await resolveSafeDestination(
    "https://public.test/webhook",
    async () => [{ address: "93.184.216.34", family: 4 }],
  );

  assert.ok(!("error" in resolved));
  assert.equal(resolved.address, "93.184.216.34");
  assert.equal(resolved.family, 4);
});

test("does not follow a redirect to a private target", async () => {
  let privateTargetHits = 0;
  const server = http.createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "http://127.0.0.1/private" });
      response.end();
      return;
    }
    privateTargetHits += 1;
    response.end("private");
  });
  const port = await listen(server);

  try {
    const response = await executePinnedRequest(localDestination(port), {
      method: "GET",
      headers: {},
      path: "/redirect",
    });

    assert.equal(response.status, 302);
    assert.equal(isOutboundRedirect(response.status), true);
    assert.equal(privateTargetHits, 0);
  } finally {
    await close(server);
  }
});

test("allows a normal non-redirecting response without following anything", async () => {
  const server = http.createServer((_request, response) => {
    response.end("ok");
  });
  const port = await listen(server);

  try {
    const response = await executePinnedRequest(localDestination(port), {
      method: "GET",
      headers: {},
      path: "/",
    });
    assert.equal(response.status, 200);
    assert.equal(response.body, "ok");
  } finally {
    await close(server);
  }
});

test("rejects direct replay attempts to loopback before connecting", async () => {
  await assert.rejects(
    executeOutboundRequest("http://127.0.0.1:3000/internal", {
      method: "GET",
      headers: {},
    }),
    OutboundDestinationError,
  );
});

test("rejects unsupported outbound protocols", async () => {
  await assert.rejects(
    executeOutboundRequest("ftp://public.test/file", {
      method: "GET",
      headers: {},
    }),
    OutboundDestinationError,
  );
});

test("rejects an outbound response that exceeds the configured byte limit", async () => {
  const server = http.createServer((_request, response) => {
    response.end("1234567890");
  });
  const port = await listen(server);

  try {
    await assert.rejects(
      executePinnedRequest(localDestination(port), {
        method: "GET",
        headers: {},
        path: "/",
        maxResponseBytes: 5,
      }),
      OutboundResponseTooLargeError,
    );
  } finally {
    await close(server);
  }
});

test("aborts an outbound request when its timeout expires", async () => {
  const server = http.createServer(() => {
    // Deliberately leave the response open.
  });
  const port = await listen(server);

  try {
    await assert.rejects(
      executePinnedRequest(localDestination(port), {
        method: "GET",
        headers: {},
        path: "/",
        timeoutMs: 20,
      }),
      OutboundTimeoutError,
    );
  } finally {
    await close(server);
  }
});

test("releases outbound capacity after a failed operation", async () => {
  const limiter = createOutboundLimiter(1);
  let releaseFirst: (() => void) | undefined;
  const first = limiter.run(
    () =>
      new Promise<void>((resolve) => {
        releaseFirst = resolve;
      }),
  );

  await assert.rejects(limiter.run(async () => undefined), /capacity/);
  releaseFirst?.();
  await first;
  await limiter.run(async () => undefined);
});

test("filters credential-bearing headers from replay while preserving content headers", () => {
  assert.deepEqual(
    filterReplayHeaders({
      authorization: "Bearer secret",
      cookie: "session=secret",
      "x-api-key": "secret",
      "content-type": "application/json",
      "x-webhook-id": "evt_123",
    }),
    {
      "content-type": "application/json",
      "x-webhook-id": "evt_123",
    },
  );
});

test("requires an inbox capability in the replay body", () => {
  assert.equal(parseReplayInput(null), null);
  assert.equal(
    parseReplayInput({ requestId: "request", targetUrl: "https://example.com" }),
    null,
  );
  assert.deepEqual(
    parseReplayInput({
      inboxId: "inbox",
      requestId: "request",
      targetUrl: "https://example.com",
    }),
    {
      inboxId: "inbox",
      requestId: "request",
      targetUrl: "https://example.com",
    },
  );
});

test("only allows replay when the request belongs to the supplied inbox", () => {
  assert.equal(isRequestOwnedByInbox({ inbox_id: "inbox-a" }, "inbox-a"), true);
  assert.equal(isRequestOwnedByInbox({ inbox_id: "inbox-a" }, "inbox-b"), false);
  assert.equal(isRequestOwnedByInbox(undefined, "inbox-a"), false);
});
