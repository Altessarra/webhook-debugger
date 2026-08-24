import assert from "node:assert/strict";
import test from "node:test";

import { parseBoundedPositiveInt } from "./runtimeConfig";

const outboundConfigs = [
  {
    name: "timeout",
    defaultValue: 15_000,
    minimum: 1_000,
    maximum: 120_000,
  },
  {
    name: "response bytes",
    defaultValue: 2 * 1024 * 1024,
    minimum: 64 * 1024,
    maximum: 16 * 1024 * 1024,
  },
  {
    name: "concurrency",
    defaultValue: 4,
    minimum: 1,
    maximum: 32,
  },
] as const;

test("accepts the configured outbound minimum and maximum boundaries", () => {
  for (const config of outboundConfigs) {
    assert.equal(
      parseBoundedPositiveInt(
        String(config.minimum),
        config.defaultValue,
        config.minimum,
        config.maximum,
      ),
      config.minimum,
      `${config.name} minimum`,
    );
    assert.equal(
      parseBoundedPositiveInt(
        String(config.maximum),
        config.defaultValue,
        config.minimum,
        config.maximum,
      ),
      config.maximum,
      `${config.name} maximum`,
    );
  }
});

test("falls back to the safe default for invalid or out-of-range outbound values", () => {
  for (const config of outboundConfigs) {
    for (const value of [
      undefined,
      "",
      "garbage",
      "0",
      "-1",
      "1.5",
      String(config.minimum - 1),
      String(config.maximum + 1),
    ]) {
      assert.equal(
        parseBoundedPositiveInt(
          value,
          config.defaultValue,
          config.minimum,
          config.maximum,
        ),
        config.defaultValue,
        `${config.name} value ${String(value)}`,
      );
    }
  }
});
