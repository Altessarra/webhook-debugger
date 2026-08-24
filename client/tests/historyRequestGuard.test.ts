import assert from "node:assert/strict";
import test from "node:test";

import {
  invalidateHistoryLoading,
  isCurrentHistoryRequest,
  settleHistoryLoading,
} from "../src/utils/historyRequestGuard";

type HistoryLoadingState = {
  historyLoading: boolean;
  loadingOlder: boolean;
};

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

function createLoadingState(initial: HistoryLoadingState): {
  state: HistoryLoadingState;
  setHistoryLoading: (value: boolean) => void;
  setLoadingOlder: (value: boolean) => void;
} {
  const state = { ...initial };
  return {
    state,
    setHistoryLoading: (value) => {
      state.historyLoading = value;
    },
    setLoadingOlder: (value) => {
      state.loadingOlder = value;
    },
  };
}

test("clears both loading flags when an inbox switch replaces history requests", () => {
  const loading = createLoadingState({
    historyLoading: true,
    loadingOlder: true,
  });

  invalidateHistoryLoading(loading);

  assert.deepEqual(loading.state, {
    historyLoading: false,
    loadingOlder: false,
  });
});

test("stale request settlement cannot clear a replacement request's loading state", () => {
  const loading = createLoadingState({
    historyLoading: true,
    loadingOlder: true,
  });
  const replacementIsCurrent = isCurrentHistoryRequest({
    activeInboxId: "new-inbox",
    initiatingInboxId: "old-inbox",
    activeGeneration: 5,
    requestGeneration: 4,
  });

  assert.equal(replacementIsCurrent, false);

  settleHistoryLoading("initial", replacementIsCurrent, loading);
  settleHistoryLoading("older", replacementIsCurrent, loading);

  assert.deepEqual(loading.state, {
    historyLoading: true,
    loadingOlder: true,
  });
});

test("current success or failure settlement clears its corresponding loading flag", () => {
  const loading = createLoadingState({
    historyLoading: true,
    loadingOlder: true,
  });

  settleHistoryLoading("initial", true, loading);
  assert.deepEqual(loading.state, {
    historyLoading: false,
    loadingOlder: true,
  });

  settleHistoryLoading("older", true, loading);
  assert.deepEqual(loading.state, {
    historyLoading: false,
    loadingOlder: false,
  });
});

test("current cancellation settlement clears both history loading flags", () => {
  const loading = createLoadingState({
    historyLoading: true,
    loadingOlder: true,
  });

  settleHistoryLoading("initial", true, loading);
  settleHistoryLoading("older", true, loading);

  assert.deepEqual(loading.state, {
    historyLoading: false,
    loadingOlder: false,
  });
});
