import assert from "node:assert/strict";
import { test } from "node:test";
import { FixedWindowLimiter } from "./rateLimit";

test("allows the first request with the full remaining count", () => {
  const limiter = new FixedWindowLimiter({
    limit: 3,
    windowMs: 60_000,
    maxKeys: 10,
    now: () => 1_000,
  });

  assert.deepEqual(limiter.check("client"), { allowed: true, remaining: 2 });
});

test("exhausts a key at its configured limit", () => {
  const limiter = new FixedWindowLimiter({
    limit: 2,
    windowMs: 60_000,
    maxKeys: 10,
    now: () => 1_000,
  });

  assert.equal(limiter.check("client").allowed, true);
  assert.equal(limiter.check("client").allowed, true);
  assert.deepEqual(limiter.check("client"), {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: 60,
  });
});

test("rounds retry-after up when 59.1 seconds remain", () => {
  let now = 900;
  const limiter = new FixedWindowLimiter({
    limit: 1,
    windowMs: 60_000,
    maxKeys: 10,
    now: () => now,
  });

  assert.equal(limiter.check("client").allowed, true);
  now = 900;
  assert.equal(limiter.check("client").retryAfterSeconds, 60);
  now = 1_900;
  assert.equal(limiter.check("client").retryAfterSeconds, 59);
});

test("resets a key at the next fixed window", () => {
  let now = 1_000;
  const limiter = new FixedWindowLimiter({
    limit: 1,
    windowMs: 60_000,
    maxKeys: 10,
    now: () => now,
  });

  assert.equal(limiter.check("client").allowed, true);
  assert.equal(limiter.check("client").allowed, false);
  now = 61_000;
  assert.deepEqual(limiter.check("client"), { allowed: true, remaining: 0 });
});

test("removes expired keys before admitting a new key", () => {
  let now = 1_000;
  const limiter = new FixedWindowLimiter({
    limit: 1,
    windowMs: 60_000,
    maxKeys: 1,
    now: () => now,
  });

  assert.equal(limiter.check("expired").allowed, true);
  now = 61_000;
  assert.deepEqual(limiter.check("new"), { allowed: true, remaining: 0 });
});

test("refuses new keys when the bounded key store is full", () => {
  let now = 1_000;
  const limiter = new FixedWindowLimiter({
    limit: 2,
    windowMs: 60_000,
    maxKeys: 1,
    now: () => now,
  });

  assert.equal(limiter.check("first").allowed, true);
  now = 1_900;
  assert.deepEqual(limiter.check("second"), {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: 60,
  });
  now = 61_000;
  assert.deepEqual(limiter.check("second"), { allowed: true, remaining: 1 });
});
