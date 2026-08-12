import { useEffect, useState } from "react";
import { uiCopy } from "../data/content";
import type { CapturedRequest } from "../types/webhook";
import type { ConnectionState } from "../types/webhook";
import { Icon } from "./Icon";
import { addInboxId, parseInboxIds } from "../utils/inboxSession";

const INBOX_IDS_STORAGE_KEY = "webhook-debugger:inbox-ids";

function getRequestTime(request: CapturedRequest) {
  return request.createdAt ?? request.created_at ?? Date.now();
}

function relativeTime(timestamp: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 10) return "now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function methodClass(method: string) {
  if (method === "POST") return "method-post";
  if (method === "PUT" || method === "PATCH") return "method-put";
  if (method === "DELETE") return "method-delete";
  return "method-default";
}

export function RequestHistory({
  requests,
  selectedId,
  freshRequestId,
  loading,
  onSelect,
  inboxId,
  inboxes,
  onSelectInbox,
  webhookUrl,
  connection,
  copied,
  onCopyUrl,
  onNewInbox,
}: {
  requests: CapturedRequest[];
  selectedId?: string;
  freshRequestId?: string | null;
  loading: boolean;
  onSelect: (request: CapturedRequest) => void;
  inboxId: string;
  inboxes?: string[];
  onSelectInbox?: (id: string) => void;
  webhookUrl: string;
  connection: ConnectionState;
  copied: boolean;
  onCopyUrl: () => void;
  onNewInbox?: () => void;
}) {
  const [inboxMenuOpen, setInboxMenuOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [sessionInboxes, setSessionInboxes] = useState(() =>
    addInboxId(
      parseInboxIds(window.localStorage.getItem(INBOX_IDS_STORAGE_KEY)),
      inboxId,
    ),
  );
  const visibleInboxes = inboxes ?? sessionInboxes;
  useEffect(() => {
    const handleCreated = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id) setSessionInboxes((current) => addInboxId(current, id));
    };
    window.addEventListener("webhook-debugger:inbox-created", handleCreated);
    return () =>
      window.removeEventListener(
        "webhook-debugger:inbox-created",
        handleCreated,
      );
  }, []);
  const createAnotherInbox = () => {
    if (onNewInbox) onNewInbox();
    else window.dispatchEvent(new CustomEvent("webhook-debugger:create-inbox"));
  };
  const clearHistory = () =>
    window.dispatchEvent(new CustomEvent("webhook-debugger:clear-history"));
  const togglePaused = () => {
    setPaused((current) => {
      const next = !current;
      window.dispatchEvent(
        new CustomEvent<boolean>("webhook-debugger:pause", { detail: next }),
      );
      return next;
    });
  };
  return (
    <aside className="inbox-pane">
      <div className="inbox-brand-row">
        <div className="brand-lockup">
          <span className="brand-mark brand-mark-small">&lt;/&gt;</span>
          <span>{uiCopy.appName}</span>
        </div>
        <div className="menu-anchor">
          <button
            type="button"
            className="icon-button"
            aria-label="Open inbox actions"
            aria-expanded={overflowOpen}
            onClick={() => setOverflowOpen((current) => !current)}
          >
            <Icon name="ellipsis" className="h-4 w-4" />
          </button>
          {overflowOpen && (
            <div className="rail-popover inbox-actions-popover">
              <button
                type="button"
                onClick={() => {
                  onCopyUrl();
                  setOverflowOpen(false);
                }}
              >
                Copy inbox URL
              </button>
              <button
                type="button"
                onClick={() => {
                  clearHistory();
                  setOverflowOpen(false);
                }}
              >
                Clear visible history
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="inbox-section inbox-select-section">
        <div className="inbox-label">Inbox</div>
        <div className="inbox-select-wrap">
          <button
            type="button"
            className="inbox-select"
            aria-label="Open inbox menu"
            aria-expanded={inboxMenuOpen}
            onClick={() => setInboxMenuOpen((current) => !current)}
          >
            <span className="live-select-dot" />
            <span className="inbox-select-id">{inboxId}</span>
            <Icon name="chevron-down" className="h-3.5 w-3.5" />
          </button>
          {inboxMenuOpen && (
            <div className="rail-popover inbox-menu-popover">
              <span>Current session</span>
              <div className="inbox-menu-list">
                {visibleInboxes.map((id, index) => (
                  <button
                    type="button"
                    key={id}
                    className={`inbox-menu-item ${id === inboxId ? "inbox-menu-item-active" : ""}`}
                    onClick={() => {
                      if (onSelectInbox) onSelectInbox(id);
                      else
                        window.dispatchEvent(
                          new CustomEvent<string>(
                            "webhook-debugger:select-inbox",
                            { detail: id },
                          ),
                        );
                      setInboxMenuOpen(false);
                    }}
                  >
                    <span>Inbox {index + 1}</span>
                    <code>{id}</code>
                    {id === inboxId && (
                      <span className="inbox-menu-current">Current</span>
                    )}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  createAnotherInbox();
                  setInboxMenuOpen(false);
                }}
              >
                <Icon name="plus" className="h-3.5 w-3.5" />
                Create new inbox
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          className="add-inbox-button"
          aria-label="Create another inbox"
          onClick={createAnotherInbox}
        >
          <Icon name="plus" className="h-4 w-4" />
        </button>
      </div>
      <div className="inbox-section url-section">
        <div className="inbox-label">Inbox URL</div>
        <div className="inbox-url-row">
          <code>{webhookUrl}</code>
          <button
            type="button"
            className="inbox-copy-button"
            onClick={onCopyUrl}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <div className="request-list-heading">
        <span>{uiCopy.requestHistory}</span>
        <span className="request-live">
          <span className="live-select-dot" />
          {paused ? "Paused" : connection === "connected" ? "Live" : connection}
        </span>
        <button
          type="button"
          className="pause-button"
          aria-label={paused ? "Resume live requests" : "Pause live requests"}
          aria-pressed={paused}
          onClick={togglePaused}
        >
          <Icon name={paused ? "play" : "pause"} className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="history-list">
        {loading && requests.length === 0 ? (
          <div className="history-state">Loading history...</div>
        ) : requests.length === 0 ? (
          <div className="history-state">
            <span>{uiCopy.waitingForRequests}</span>
            <small>{uiCopy.waitingDescription}</small>
          </div>
        ) : (
          requests.map((request) => (
            <button
              type="button"
              key={request.id}
              onClick={() => onSelect(request)}
              className={`history-row ${selectedId === request.id ? "history-row-selected" : ""} ${freshRequestId === request.id ? "history-row-fresh" : ""}`}
            >
              <div className="history-row-top">
                <span className={`method-text ${methodClass(request.method)}`}>
                  <span className="method-dot" />
                  {request.method}
                </span>
                <span className="mono-muted">
                  {relativeTime(getRequestTime(request))}
                </span>
              </div>
              <span className="history-path">{request.path}</span>
            </button>
          ))
        )}
      </div>
      <div className="inbox-footer">
        <span>
          <span className="live-select-dot" />
          Connected
        </span>
        <span>{requests.length} new requests</span>
      </div>
    </aside>
  );
}
