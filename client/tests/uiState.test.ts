import assert from "node:assert/strict";
import test from "node:test";
import { nextPayloadFormat, type PayloadFormat } from "../src/utils/uiState";

test("toggles payload format between pretty and raw", () => {
  const formats: PayloadFormat[] = ["pretty", "raw"];
  assert.equal(nextPayloadFormat("pretty"), "raw");
  assert.equal(nextPayloadFormat("raw"), "pretty");
  assert.ok(formats.includes(nextPayloadFormat("pretty")));
});
