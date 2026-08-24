import assert from "node:assert/strict";
import test from "node:test";

import { isCurrentHistoryRequest } from "../src/utils/historyRequestGuard";

test("accepts a response from the active inbox request generation", () => {
  assert.equal(
    isCurrentHistoryRequest({
      activeInboxId: "active-inbox",
      initiatingInboxId: "active-inbox",
      activeGeneration: 4,
      requestGeneration: 4,
    }),
    true,
  );
});

test("rejects history responses after the active inbox changes", () => {
  assert.equal(
    isCurrentHistoryRequest({
      activeInboxId: "new-inbox",
      initiatingInboxId: "old-inbox",
      activeGeneration: 4,
      requestGeneration: 4,
    }),
    false,
  );
});

test("rejects history responses from a cancelled or replaced generation", () => {
  assert.equal(
    isCurrentHistoryRequest({
      activeInboxId: "active-inbox",
      initiatingInboxId: "active-inbox",
      activeGeneration: 5,
      requestGeneration: 4,
    }),
    false,
  );
});
