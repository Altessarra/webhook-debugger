import assert from "node:assert/strict";
import test from "node:test";
import {
  isBlockedAddress,
  resolveSafeDestination,
  validateManualRequest,
} from "./manualRequest";

test("accepts an HTTPS JSON request for manual sending", () => {
  assert.equal(
    validateManualRequest({
      method: "POST",
      targetUrl: "https://example.com/webhook",
      headers: '{"content-type":"application/json"}',
      body: '{"hello":"world"}',
    }),
    null,
  );
});

test("rejects invalid JSON before sending a manual request", () => {
  assert.equal(
    validateManualRequest({
      method: "POST",
      targetUrl: "https://example.com/webhook",
      headers: '{"content-type":"application/json"}',
      body: "{hello}",
    }),
    "Payload must be valid JSON",
  );
});

test("rejects private addresses for outbound requests", () => {
  assert.equal(isBlockedAddress("127.0.0.1"), true);
  assert.equal(isBlockedAddress("10.0.0.8"), true);
  assert.equal(isBlockedAddress("169.254.169.254"), true);
  assert.equal(isBlockedAddress("::1"), true);
  assert.equal(isBlockedAddress("fc00::1"), true);
  assert.equal(isBlockedAddress("[::1]"), true);
});

test("rejects a malformed manual request body without throwing", () => {
  assert.equal(
    validateManualRequest({
      method: "POST",
      targetUrl: "https://example.com/webhook",
      headers: "{}",
      body: "",
    }),
    null,
  );
});

test("rejects private DNS answers even when the hostname looks public", async () => {
  const result = await resolveSafeDestination(
    "https://public.test/webhook",
    async () => [{ address: "192.168.1.10", family: 4 }],
  );
  assert.deepEqual(result, {
    error: "Destination resolves to a private or internal address",
  });
});

test("allows raw bodies when the content type is not JSON", () => {
  assert.equal(
    validateManualRequest({
      method: "POST",
      targetUrl: "https://example.com/webhook",
      headers: '{"content-type":"text/plain"}',
      body: "hello=world",
    }),
    null,
  );
});
