export type HistoryLoadingSetters = {
  setHistoryLoading: (value: boolean) => void;
  setLoadingOlder: (value: boolean) => void;
};

export type HistoryLoadingKind = "initial" | "older";

export function isCurrentHistoryRequest({
  activeInboxId,
  initiatingInboxId,
  activeGeneration,
  requestGeneration,
}: {
  activeInboxId: string | null;
  initiatingInboxId: string;
  activeGeneration: number;
  requestGeneration: number;
}) {
  return (
    activeInboxId === initiatingInboxId &&
    activeGeneration === requestGeneration
  );
}

export function invalidateHistoryLoading({
  setHistoryLoading,
  setLoadingOlder,
}: HistoryLoadingSetters) {
  setHistoryLoading(false);
  setLoadingOlder(false);
}

export function settleHistoryLoading(
  kind: HistoryLoadingKind,
  requestIsCurrent: boolean,
  { setHistoryLoading, setLoadingOlder }: HistoryLoadingSetters,
) {
  if (!requestIsCurrent) return;
  if (kind === "initial") setHistoryLoading(false);
  else setLoadingOlder(false);
}
