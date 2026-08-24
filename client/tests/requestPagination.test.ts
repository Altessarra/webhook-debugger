import assert from "node:assert/strict";
import test from "node:test";
import {
  appendRequestPage,
  type RequestHistoryPage,
} from "../src/utils/requestPagination";
import type { CapturedRequest } from "../src/types/webhook";

const request = (id: string, createdAt: number): CapturedRequest => ({
  id,
  method: "POST",
  path: `/${id}`,
  headers: "{}",
  body: null,
  query: "{}",
  createdAt,
});

test("appends an older page while preserving newest-first history", () => {
  const current = [request("newest", 300), request("middle", 200)];
  const page: RequestHistoryPage = {
    requests: [request("older", 100)],
    nextCursor: "cursor-for-oldest",
  };

  const result = appendRequestPage(current, page);

  assert.deepEqual(
    result.requests.map((item) => item.id),
    ["newest", "middle", "older"],
  );
  assert.equal(result.nextCursor, "cursor-for-oldest");
});

test("deduplicates a repeated cursor boundary while appending older history", () => {
  const result = appendRequestPage(
    [request("newest", 300), request("boundary", 200)],
    {
      requests: [request("boundary", 200), request("older", 100)],
      nextCursor: "cursor-for-oldest",
    },
  );

  assert.deepEqual(
    result.requests.map((item) => item.id),
    ["newest", "boundary", "older"],
  );
});

test("stops pagination when the server has no next cursor", () => {
  const result = appendRequestPage([request("newest", 300)], {
    requests: [request("older", 100)],
    nextCursor: null,
  });

  assert.equal(result.nextCursor, null);
});
