/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  isSensitiveHeader,
  maskSensitiveHeaders,
} from "./sensitiveHeaders";

test("matches sensitive header names case-insensitively", () => {
  assert.equal(isSensitiveHeader("Authorization"), true);
  assert.equal(isSensitiveHeader("set-cookie"), true);
  assert.equal(isSensitiveHeader("X-API-Key"), true);
  assert.equal(isSensitiveHeader("x-access-token"), true);
  assert.equal(isSensitiveHeader("Stripe-Signature"), true);
  assert.equal(isSensitiveHeader("X-Hub-Signature-256"), true);
  assert.equal(isSensitiveHeader("X-Shopify-Hmac-Sha256"), true);
  assert.equal(isSensitiveHeader("content-type"), false);
});

test("matches generic credential-bearing header names without broad substring matching", () => {
  assert.equal(isSensitiveHeader("x-client-secret"), true);
  assert.equal(isSensitiveHeader("X-Password"), true);
  assert.equal(isSensitiveHeader("x-private-key"), true);
  assert.equal(isSensitiveHeader("x-service-credentials"), true);
  assert.equal(isSensitiveHeader("x-secretary"), false);
  assert.equal(isSensitiveHeader("x-debug-token-count"), false);
  assert.equal(isSensitiveHeader("x-request-id"), false);
});

test("masks only sensitive header values while leaving ordinary headers readable", () => {
  const rawHeaders = JSON.stringify(
    {
      Authorization: "Bearer super-secret",
      "x-client-secret": "client-secret",
      "content-type": "application/json",
      "Stripe-Signature": "t=1,v1=abc123",
      "x-request-id": "req_123",
    },
    null,
    2,
  );

  const masked = maskSensitiveHeaders(rawHeaders, false);

  assert.deepEqual(JSON.parse(masked), {
    Authorization: "[REDACTED]",
    "x-client-secret": "[REDACTED]",
    "content-type": "application/json",
    "Stripe-Signature": "[REDACTED]",
    "x-request-id": "req_123",
  });
});

test("preserves malformed raw header text unchanged", () => {
  const malformed = "{not-json";

  assert.equal(maskSensitiveHeaders(malformed, false), malformed);
});

test("returns the original raw header text when reveal is enabled", () => {
  const rawHeaders = JSON.stringify(
    {
      Cookie: "session=abc123",
      "x-webhook-signature": "sig_456",
      accept: "application/json",
    },
    null,
    2,
  );

  assert.equal(maskSensitiveHeaders(rawHeaders, true), rawHeaders);
});
