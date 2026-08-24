import { JsonViewer } from "./JsonViewer";
import { maskSensitiveHeaders } from "../utils/sensitiveHeaders";

export function SensitiveHeadersViewer({
  headers,
  revealed,
  onToggleReveal,
}: {
  headers: string | null | undefined;
  revealed: boolean;
  onToggleReveal: () => void;
}) {
  const displayHeaders = headers
    ? maskSensitiveHeaders(headers, revealed)
    : headers;

  return (
    <>
      <div className="section-title">
        <span>
          {revealed
            ? "Sensitive values are visible for this request"
            : "Sensitive values are masked for this request"}
        </span>
        <button
          type="button"
          className="view-all-button"
          onClick={onToggleReveal}
        >
          {revealed ? "Hide sensitive" : "Reveal sensitive"}
        </button>
      </div>
      <JsonViewer value={displayHeaders} emptyLabel="No headers received" />
    </>
  );
}
