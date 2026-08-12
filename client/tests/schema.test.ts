import assert from "node:assert/strict";
import test from "node:test";
import { inferSchema } from "../src/utils/schema";

test("infers primitive property types", () => {
  assert.deepEqual(inferSchema({ id: "evt_123", amount: 2499, live: false }), {
    type: "object",
    properties: {
      id: { type: "string" },
      amount: { type: "number" },
      live: { type: "boolean" },
    },
  });
});

test("infers nested objects and arrays", () => {
  assert.deepEqual(
    inferSchema({
      data: { customer: { email: "jane@example.com" } },
      items: [{ id: "item_1" }],
    }),
    {
      type: "object",
      properties: {
        data: {
          type: "object",
          properties: {
            customer: {
              type: "object",
              properties: { email: { type: "string" } },
            },
          },
        },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" } },
          },
        },
      },
    },
  );
});

test("represents empty arrays and null values safely", () => {
  assert.deepEqual(inferSchema({ tags: [], deletedAt: null }), {
    type: "object",
    properties: {
      tags: { type: "array", items: { type: "unknown" } },
      deletedAt: { type: "null" },
    },
  });
});
