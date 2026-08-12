import test from "node:test";
import assert from "node:assert/strict";
import { clampPaneWidth, resizePaneWidth } from "../src/utils/paneResize";

test("clamps a pane width to its minimum and maximum", () => {
  assert.equal(clampPaneWidth(200, 300, 700), 300);
  assert.equal(clampPaneWidth(900, 300, 700), 700);
  assert.equal(clampPaneWidth(480, 300, 700), 480);
});

test("applies pointer movement to a pane width before clamping", () => {
  assert.equal(resizePaneWidth(420, 80, 300, 700), 500);
  assert.equal(resizePaneWidth(420, -200, 300, 700), 300);
});
