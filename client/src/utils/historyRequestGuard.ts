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
