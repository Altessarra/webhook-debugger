import assert from "node:assert/strict";
import test from "node:test";
import { addInboxId, parseInboxIds } from "../src/utils/inboxSession";

test("parses a stored inbox list and removes invalid duplicates", () => {
  assert.deepEqual(parseInboxIds('["abc", "abc", "", 42, "def"]'), [
    "abc",
    "def",
  ]);
  assert.deepEqual(parseInboxIds("not-json"), []);
});

test("adds a newly created inbox to the front without duplicates", () => {
  assert.deepEqual(addInboxId(["abc", "def"], "def"), ["def", "abc"]);
  assert.deepEqual(addInboxId([], "abc"), ["abc"]);
});
