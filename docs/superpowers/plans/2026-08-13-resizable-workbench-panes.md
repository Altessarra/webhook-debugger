# Resizable Workbench Panes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Inbox, Request Details, and Request Inspector panes resizable with draggable desktop split handles while preserving the existing stacked mobile layout.

**Architecture:** Keep the existing four-column CSS grid, with the global rail remaining fixed. Store the two adjustable pane widths in `App.tsx`, expose them as CSS custom properties, and insert two accessible resize handles between the three functional panes. Pure width-clamping logic lives in a small utility so keyboard and pointer resizing share the same constraints.

**Tech Stack:** React, TypeScript, CSS Grid, Pointer Events, Node test runner through `tsx`.

## Global Constraints

- Do not add dependencies.
- Keep the rail fixed and only resize the three functional panes.
- Hide resize handles when the workbench stacks on mobile.
- Enforce minimum widths so each pane remains usable.
- Preserve existing request capture, replay, inbox, and payload behavior.

---

### Task 1: Add tested pane-width calculations

**Files:**
- Create: `client/src/utils/paneResize.ts`
- Create: `client/tests/paneResize.test.ts`

**Interfaces:**
- Produces `clampPaneWidth(value: number, min: number, max: number): number`.
- Produces `resizePaneWidth(startWidth: number, deltaX: number, min: number, max: number): number`.

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `client`:

```powershell
..\server\node_modules\.bin\tsx.cmd --test tests/paneResize.test.ts
```

Expected: FAIL because `src/utils/paneResize.ts` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

```ts
export function clampPaneWidth(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function resizePaneWidth(
  startWidth: number,
  deltaX: number,
  min: number,
  max: number,
) {
  return clampPaneWidth(startWidth + deltaX, min, max);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run the same command and expect both tests to pass.

### Task 2: Add accessible resize handles and wire the three-pane grid

**Files:**
- Create: `client/src/components/PaneResizeHandle.tsx`
- Modify: `client/src/App.tsx:1-1035`
- Modify: `client/src/index.css:887-930,1720-1810`

**Interfaces:**
- `PaneResizeHandle` consumes `label`, `onPointerDown`, and `onKeyDown` callbacks and renders a focusable vertical separator.
- `App.tsx` owns `{ inbox, request }` widths, updates them from pointer/keyboard deltas, and passes CSS variables to `.reference-workbench`.

- [ ] **Step 1: Add the handle component with keyboard semantics**

Render a `div` with `role="separator"`, `aria-orientation="vertical"`, `tabIndex={0}`, a descriptive `aria-label`, and pointer/keyboard handlers.

- [ ] **Step 2: Add pointer and keyboard resize state in `App.tsx`**

Use minimum widths of 260px for Inbox, 360px for Request Details, and 360px for Payload. Pointer movement changes the pane adjacent to the handle. Arrow keys move the active divider by 16px; Home/End reset the relevant divider to its initial width.

- [ ] **Step 3: Insert handles between the three functional panes**

Keep `AppRail` as the first fixed grid column, then render `RequestHistory`, handle 1, request section, handle 2, and payload section.

- [ ] **Step 4: Update grid CSS and responsive behavior**

Use CSS variables for the two adjustable widths and two 10px handle columns. Add hover/focus styling with the existing gold accent. Hide handles and retain the current stacked flex layout at `max-width: 860px`.

### Task 3: Verify the complete feature

**Files:**
- Test: `client/tests/paneResize.test.ts`
- Verify: `client/src/App.tsx`, `client/src/components/PaneResizeHandle.tsx`, `client/src/index.css`

- [ ] **Step 1: Run focused utility tests**

```powershell
..\server\node_modules\.bin\tsx.cmd --test tests/paneResize.test.ts
```

- [ ] **Step 2: Run the existing client tests**

```powershell
..\server\node_modules\.bin\tsx.cmd --test tests/inboxSession.test.ts tests/schema.test.ts tests/uiState.test.ts tests/paneResize.test.ts
```

- [ ] **Step 3: Run static checks**

```powershell
npm run lint
npx tsc -b --pretty false
git diff --check
```

- [ ] **Step 4: Run the production build**

```powershell
npm run build
```

Expected: Vite completes and emits the client bundle.
