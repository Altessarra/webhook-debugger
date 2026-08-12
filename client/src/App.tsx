import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { AppRail } from "./components/AppRail";
import { AppShell } from "./components/AppShell";
import { Icon } from "./components/Icon";
import { JsonViewer } from "./components/JsonViewer";
import {
  ManualRequestForm,
  type ManualRequestDraft,
  type ManualRequestResult,
} from "./components/ManualRequestForm";
import { PaneResizeHandle } from "./components/PaneResizeHandle";
import { RequestHistory } from "./components/RequestHistory";
import { SchemaViewer } from "./components/SchemaViewer";
import { uiCopy } from "./data/content";
import { Code } from "./pages/Code";
import { Help } from "./pages/Help";
import { Settings } from "./pages/Settings";
import type {
  CapturedRequest,
  ConnectionState,
  CopyTarget,
} from "./types/webhook";
import type { Theme } from "./types/theme";
import { parseJsonValue } from "./utils/json";
import { addInboxId, parseInboxIds } from "./utils/inboxSession";
import { resizePaneWidth } from "./utils/paneResize";
import { nextPayloadFormat, type PayloadFormat } from "./utils/uiState";

const API_URL = "";
const WS_URL = import.meta.env.DEV
  ? "ws://127.0.0.1:3000"
  : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
const DISPLAY_ORIGIN = window.location.origin;
const INBOX_STORAGE_KEY = "webhook-debugger:inbox-id";
const INBOX_IDS_STORAGE_KEY = "webhook-debugger:inbox-ids";
const REQUEST_TIMEOUT_MS = 15000;

type DetailTab = "overview" | "headers" | "query" | "raw";
type PayloadTab = "payload" | "schema";
type ResizablePane = "inbox" | "request";

const PANE_MIN_WIDTHS: Record<ResizablePane, number> = {
  inbox: 260,
  request: 360,
};
const PAYLOAD_MIN_WIDTH = 360;
const RESIZE_HANDLE_WIDTH = 20;

function getInitialPaneWidths() {
  return window.innerWidth <= 1200
    ? { inbox: 310, request: 380 }
    : { inbox: 357, request: 469 };
}

function getRequestTime(request: CapturedRequest) {
  return request.createdAt ?? request.created_at ?? Date.now();
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString([], {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function methodClass(method: string) {
  if (method === "POST") return "method-post";
  if (method === "PUT" || method === "PATCH") return "method-put";
  if (method === "DELETE") return "method-delete";
  return "method-default";
}

function formatBytes(value: string | null) {
  if (!value) return "—";
  const bytes = new TextEncoder().encode(value).length;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function getInitialInboxIds() {
  const storedIds = parseInboxIds(
    window.localStorage.getItem(INBOX_IDS_STORAGE_KEY),
  );
  const activeId = window.localStorage.getItem(INBOX_STORAGE_KEY);
  return activeId ? addInboxId(storedIds, activeId) : storedIds;
}

function StatusPill({ connection }: { connection: ConnectionState }) {
  const config = {
    connecting: "Connecting",
    connected: "Live",
    disconnected: "Offline",
  }[connection];
  return (
    <span className={`status-pill status-${connection}`}>
      <span className="status-dot" />
      {config}
    </span>
  );
}

function CopyButton({
  copied,
  onClick,
  label = uiCopy.copy,
}: {
  copied: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button type="button" className="copy-button" onClick={onClick}>
      <Icon name={copied ? "check" : "clipboard"} className="h-3.5 w-3.5" />
      {copied ? uiCopy.copied : label}
    </button>
  );
}

function MetaSection({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="reference-section">
      <div className="reference-section-title">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

function TabBar({
  active,
  onChange,
  tabs,
}: {
  active: string;
  onChange: (tab: string) => void;
  tabs: Array<{ id: string; label: string }>;
}) {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.id}
          className={active === tab.id ? "tab-active" : ""}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = window.localStorage.getItem("webhook-debugger:theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  });
  const [inboxId, setInboxId] = useState<string | null>(() =>
    window.localStorage.getItem(INBOX_STORAGE_KEY),
  );
  const [inboxes, setInboxes] = useState<string[]>(getInitialInboxIds);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [requests, setRequests] = useState<CapturedRequest[]>([]);
  const [selected, setSelected] = useState<CapturedRequest | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("disconnected");
  const [copyTarget, setCopyTarget] = useState<CopyTarget>(null);
  const [error, setError] = useState<string | null>(null);
  const [freshRequestId, setFreshRequestId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [payloadTab, setPayloadTab] = useState<PayloadTab>("payload");
  const [payloadFormat, setPayloadFormat] = useState<PayloadFormat>("pretty");
  const [paused, setPaused] = useState(false);
  const [initialPaneWidths] = useState(getInitialPaneWidths);
  const [paneWidths, setPaneWidths] = useState(initialPaneWidths);
  const workbenchRef = useRef<HTMLDivElement | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pausedRef = useRef(false);
  const [replayUrl, setReplayUrl] = useState("");
  const [replaying, setReplaying] = useState(false);
  const [replayResult, setReplayResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [stripeSecret, setStripeSecret] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    valid: boolean;
    reason?: string;
  } | null>(null);

  const getPaneMaxWidth = useCallback(
    (pane: ResizablePane, widths: typeof paneWidths) => {
      const railWidth = window.innerWidth <= 1200 ? 64 : 80;
      const workbenchWidth =
        workbenchRef.current?.clientWidth ?? window.innerWidth;
      const otherPaneWidth = pane === "inbox" ? widths.request : widths.inbox;
      return Math.max(
        PANE_MIN_WIDTHS[pane],
        workbenchWidth -
          railWidth -
          otherPaneWidth -
          PAYLOAD_MIN_WIDTH -
          RESIZE_HANDLE_WIDTH,
      );
    },
    [],
  );

  const handleResizePointerDown = useCallback(
    (pane: ResizablePane, event: ReactPointerEvent<HTMLDivElement>) => {
      if (window.innerWidth <= 860) return;
      event.preventDefault();
      resizeCleanupRef.current?.();
      const startX = event.clientX;
      const startWidth = paneWidths[pane];
      const maxWidth = getPaneMaxWidth(pane, paneWidths);
      const handleMove = (moveEvent: PointerEvent) => {
        setPaneWidths((current) => ({
          ...current,
          [pane]: resizePaneWidth(
            startWidth,
            moveEvent.clientX - startX,
            PANE_MIN_WIDTHS[pane],
            maxWidth,
          ),
        }));
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
        resizeCleanupRef.current = null;
      };
      resizeCleanupRef.current = cleanup;
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", cleanup);
      window.addEventListener("pointercancel", cleanup);
    },
    [getPaneMaxWidth, paneWidths],
  );

  const handleResizeKeyDown = useCallback(
    (pane: ResizablePane, event: ReactKeyboardEvent<HTMLDivElement>) => {
      const delta = event.key === "ArrowRight" ? 16 : event.key === "ArrowLeft" ? -16 : null;
      if (delta === null && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      setPaneWidths((current) => {
        const maxWidth = getPaneMaxWidth(pane, current);
        const nextWidth =
          event.key === "Home"
            ? initialPaneWidths[pane]
            : event.key === "End"
              ? maxWidth
              : resizePaneWidth(
                  current[pane],
                  delta ?? 0,
                  PANE_MIN_WIDTHS[pane],
                  maxWidth,
                );
        return { ...current, [pane]: nextWidth };
      });
    },
    [getPaneMaxWidth, initialPaneWidths],
  );

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  const workbenchStyle = {
    "--inbox-pane-width": `${paneWidths.inbox}px`,
    "--request-pane-width": `${paneWidths.request}px`,
  } as CSSProperties;

  const webhookUrl = inboxId ? `${DISPLAY_ORIGIN}/i/${inboxId}` : "";
  const curlCommand = inboxId
    ? `curl -X POST ${webhookUrl} -H "Content-Type: application/json" -d "{\\"hello\\":\\"world\\"}"`
    : "";

  const onToggleTheme = () =>
    setTheme((current) => (current === "dark" ? "light" : "dark"));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("webhook-debugger:theme", theme);
  }, [theme]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const handleThemeChange = (event: Event) => {
      const nextTheme = (event as CustomEvent<Theme>).detail;
      if (nextTheme === "light" || nextTheme === "dark") setTheme(nextTheme);
    };
    window.addEventListener("webhook-debugger:theme-change", handleThemeChange);
    return () =>
      window.removeEventListener(
        "webhook-debugger:theme-change",
        handleThemeChange,
      );
  }, []);

  useEffect(() => {
    const handlePause = (event: Event) =>
      setPaused((event as CustomEvent<boolean>).detail);
    const handleClearHistory = () => {
      setRequests([]);
      setSelected(null);
    };
    window.addEventListener("webhook-debugger:pause", handlePause);
    window.addEventListener(
      "webhook-debugger:clear-history",
      handleClearHistory,
    );
    return () => {
      window.removeEventListener("webhook-debugger:pause", handlePause);
      window.removeEventListener(
        "webhook-debugger:clear-history",
        handleClearHistory,
      );
    };
  }, []);

  useEffect(() => {
    const handleFormatClick = (event: Event) => {
      if ((event.target as HTMLElement).closest(".payload-format"))
        setPayloadFormat((current) => nextPayloadFormat(current));
    };
    const handleFormatKey = (event: KeyboardEvent) => {
      if (
        (event.key === "Enter" || event.key === " ") &&
        (event.target as HTMLElement).closest(".payload-format")
      ) {
        event.preventDefault();
        setPayloadFormat((current) => nextPayloadFormat(current));
      }
    };
    document.addEventListener("click", handleFormatClick);
    document.addEventListener("keydown", handleFormatKey);
    return () => {
      document.removeEventListener("click", handleFormatClick);
      document.removeEventListener("keydown", handleFormatKey);
    };
  }, []);

  useEffect(() => {
    document
      .querySelectorAll<HTMLElement>(".payload-format")
      .forEach((element) => {
        element.textContent = `${payloadFormat === "pretty" ? "Pretty" : "Raw"}⌄`;
        element.setAttribute(
          "aria-label",
          `Switch payload format to ${payloadFormat === "pretty" ? "raw" : "pretty"}`,
        );
        element.setAttribute("role", "button");
        element.setAttribute("tabindex", "0");
      });
  }, [payloadFormat]);

  useEffect(() => {
    if (inboxId) window.localStorage.setItem(INBOX_STORAGE_KEY, inboxId);
    else window.localStorage.removeItem(INBOX_STORAGE_KEY);
  }, [inboxId]);

  useEffect(() => {
    window.localStorage.setItem(INBOX_IDS_STORAGE_KEY, JSON.stringify(inboxes));
  }, [inboxes]);

  const createInbox = async () => {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );
    try {
      const res = await fetch(`${API_URL}/api/inboxes`, {
        method: "POST",
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("Unable to create an inbox");
      const data = (await res.json()) as { id: string };
      if (!data.id) throw new Error("The server returned an invalid inbox");
      setRequests([]);
      setSelected(null);
      setInboxes((current) => addInboxId(current, data.id));
      window.dispatchEvent(
        new CustomEvent<string>("webhook-debugger:inbox-created", {
          detail: data.id,
        }),
      );
      setInboxId(data.id);
      navigate("/requests");
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === "AbortError"
          ? "The server took too long to respond. Try again in a moment."
          : err instanceof Error
            ? err.message
            : "Unable to create an inbox",
      );
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  };

  useEffect(() => {
    const handleCreateInbox = () => {
      void createInbox();
    };
    window.addEventListener("webhook-debugger:create-inbox", handleCreateInbox);
    return () =>
      window.removeEventListener(
        "webhook-debugger:create-inbox",
        handleCreateInbox,
      );
  });

  const copyText = async (text: string, target: CopyTarget) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyTarget(target);
      window.setTimeout(() => setCopyTarget(null), 2000);
    } catch {
      setError("Copy failed. Select the value manually.");
    }
  };

  useEffect(() => {
    if (!inboxId) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) {
          setHistoryLoading(true);
          setError(null);
        }
        return fetch(`${API_URL}/api/inboxes/${inboxId}/requests`);
      })
      .then(async (res) => {
        if (!res.ok)
          throw new Error(
            res.status === 404
              ? "This inbox no longer exists"
              : "Unable to load request history",
          );
        return (await res.json()) as { requests: CapturedRequest[] };
      })
      .then((data) => {
        if (!cancelled)
          setRequests(
            data.requests.map((request) => ({
              ...request,
              createdAt: getRequestTime(request),
            })),
          );
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message =
            err instanceof Error
              ? err.message
              : "Unable to load request history";
          if (message !== "This inbox no longer exists") setError(message);
          setInboxes((current) => current.filter((id) => id !== inboxId));
          setInboxId(null);
          navigate("/");
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inboxId, navigate]);

  useEffect(() => {
    if (!inboxId) return;
    Promise.resolve().then(() => setConnection("connecting"));
    const ws = new WebSocket(`${WS_URL}?inboxId=${inboxId}`);
    wsRef.current = ws;
    ws.onopen = () => setConnection("connected");
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data) as {
        type: string;
        request: CapturedRequest;
      };
      if (data.type !== "new_request") return;
      const request = {
        ...data.request,
        createdAt: getRequestTime(data.request),
      };
      if (pausedRef.current) return;
      setRequests((prev) => [
        request,
        ...prev.filter((item) => item.id !== request.id),
      ]);
      setSelected((current) => current ?? request);
      setFreshRequestId(request.id);
      window.setTimeout(() => setFreshRequestId(null), 350);
    };
    ws.onclose = () => setConnection("disconnected");
    ws.onerror = () => setConnection("disconnected");
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [inboxId]);

  const selectRequest = (request: CapturedRequest) => {
    setSelected(request);
    setDetailTab("overview");
    setPayloadTab("payload");
    setReplayResult(null);
    setVerifyResult(null);
    setStripeSecret("");
    setCopyTarget(null);
  };

  const selectInbox = useCallback(
    (nextInboxId: string) => {
      if (nextInboxId === inboxId) return;
      setRequests([]);
      setSelected(null);
      setError(null);
      setInboxId(nextInboxId);
      navigate("/requests");
    },
    [inboxId, navigate],
  );

  useEffect(() => {
    const handleSelectInbox = (event: Event) =>
      selectInbox((event as CustomEvent<string>).detail);
    window.addEventListener("webhook-debugger:select-inbox", handleSelectInbox);
    return () =>
      window.removeEventListener(
        "webhook-debugger:select-inbox",
        handleSelectInbox,
      );
  }, [selectInbox]);

  const replayRequest = async () => {
    if (!selected || !replayUrl) return;
    setReplaying(true);
    setReplayResult(null);
    try {
      const res = await fetch(`${API_URL}/api/replay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: selected.id, targetUrl: replayUrl }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        status?: number;
        statusText?: string;
        error?: string;
      };
      if (!res.ok || !data.success)
        throw new Error(data.error ?? "Replay failed");
      setReplayResult({
        success: true,
        message: `${data.status} ${data.statusText}`,
      });
    } catch (err) {
      setReplayResult({
        success: false,
        message: err instanceof Error ? err.message : "Failed to reach target",
      });
    } finally {
      setReplaying(false);
    }
  };

  const verifySignature = async () => {
    if (!selected || !stripeSecret) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      const headers = parseJsonValue(selected.headers) as Record<
        string,
        string
      > | null;
      const signatureHeader = headers?.["stripe-signature"];
      if (!signatureHeader) {
        setVerifyResult({
          valid: false,
          reason: "No stripe-signature header found",
        });
        return;
      }
      const res = await fetch(`${API_URL}/api/verify-stripe-signature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: selected.body,
          signatureHeader,
          secret: stripeSecret,
        }),
      });
      setVerifyResult(
        (await res.json()) as { valid: boolean; reason?: string },
      );
    } catch {
      setVerifyResult({ valid: false, reason: "Verification request failed" });
    } finally {
      setVerifying(false);
    }
  };

  const sendManualRequest = async (
    draft: ManualRequestDraft,
  ): Promise<ManualRequestResult> => {
    try {
      const res = await fetch(`${API_URL}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = (await res.json()) as {
        success?: boolean;
        status?: number;
        statusText?: string;
        error?: string;
        responseBody?: string;
        responseHeaders?: Record<string, string>;
        durationMs?: number;
      };
      if (!res.ok || !data.success)
        return { success: false, message: data.error ?? "Request failed" };
      return {
        success: true,
        message: `${data.status} ${data.statusText}`,
        status: data.status,
        statusText: data.statusText,
        responseBody: data.responseBody,
        responseHeaders: data.responseHeaders,
        durationMs: data.durationMs,
      };
    } catch {
      return { success: false, message: "Unable to reach the send service" };
    }
  };

  if (location.pathname === "/settings") {
    return (
      <AppShell theme={theme} onToggleTheme={onToggleTheme}>
        <Settings
          theme={theme}
          onThemeChange={(nextTheme) => {
            if (nextTheme !== theme) onToggleTheme();
          }}
        />
      </AppShell>
    );
  }

  if (location.pathname === "/code") {
    return (
      <AppShell theme={theme} onToggleTheme={onToggleTheme}>
        <Code
          webhookUrl={webhookUrl}
          curlCommand={curlCommand}
          copied={copyTarget === "curl"}
          onCopy={() => copyText(curlCommand, "curl")}
        />
      </AppShell>
    );
  }

  if (location.pathname === "/help") {
    return (
      <AppShell theme={theme} onToggleTheme={onToggleTheme}>
        <Help />
      </AppShell>
    );
  }

  if (location.pathname !== "/" && location.pathname !== "/requests") {
    return <Navigate to={inboxId ? "/requests" : "/"} replace />;
  }

  if (!inboxId) {
    return (
      <AppShell theme={theme} onToggleTheme={onToggleTheme}>
        <div className="empty-shell">
          <header className="empty-topbar">
            <div className="brand-lockup">
              <span className="brand-mark">&lt;/&gt;</span>
              <span>{uiCopy.appName}</span>
            </div>
            <span className="topbar-note">Local request inspection</span>
          </header>
          <section className="empty-document">
            <p className="editorial-kicker">{uiCopy.landingKicker}</p>
            <h1>{uiCopy.landingTitle}</h1>
            <p className="empty-description">{uiCopy.landingDescription}</p>
            <div className="empty-actions">
              <button
                type="button"
                className="primary-button"
                onClick={createInbox}
                disabled={loading}
                aria-busy={loading}
              >
                {loading ? (
                  <>
                    <Icon name="loader" className="h-4 w-4 animate-spin" />
                    Creating
                  </>
                ) : (
                  <>
                    <Icon name="spark" className="h-4 w-4" />
                    {uiCopy.createInbox}
                  </>
                )}
              </button>
              <span className="mono-note">
                No account required · ephemeral inboxes
              </span>
            </div>
            {error && (
              <div className="error-banner">
                <Icon name="x" className="h-4 w-4" />
                {error}
              </div>
            )}
            <div className="document-rule" />
            <div className="document-footer">
              <span>01 / READY WHEN YOU ARE</span>
              <span>HTTP · JSON · WEBSOCKETS</span>
            </div>
          </section>
        </div>
      </AppShell>
    );
  }

  if (location.pathname === "/") return <Navigate to="/requests" replace />;

  const selectedHeaders = selected
    ? (parseJsonValue(selected.headers) as Record<string, string> | null)
    : null;
  const query = selected
    ? (parseJsonValue(selected.query) as Record<string, string> | null)
    : null;
  const hasStripeSignature = !!selectedHeaders?.["stripe-signature"];
  const headerEntries = selectedHeaders ? Object.entries(selectedHeaders) : [];

  const renderOverview = () => (
    <>
      <MetaSection title="Request">
        <div className="key-value-list">
          <div>
            <span>Method</span>
            <code>{selected?.method}</code>
          </div>
          <div>
            <span>Path</span>
            <code>{selected?.path}</code>
          </div>
          <div>
            <span>Source IP</span>
            <code>
              {selectedHeaders?.["x-forwarded-for"] ??
                selectedHeaders?.["x-real-ip"] ??
                "—"}
            </code>
          </div>
          <div>
            <span>User Agent</span>
            <code>{selectedHeaders?.["user-agent"] ?? "—"}</code>
          </div>
          <div>
            <span>Content Type</span>
            <code>{selectedHeaders?.["content-type"] ?? "—"}</code>
          </div>
          <div>
            <span>Content Length</span>
            <code>{formatBytes(selected?.body ?? null)}</code>
          </div>
          <div>
            <span>Request ID</span>
            <code>{selected?.id}</code>
          </div>
        </div>
      </MetaSection>
      <MetaSection
        title="Headers"
        action={
          <button
            type="button"
            className="view-all-button"
            onClick={() => setDetailTab("headers")}
          >
            View all
          </button>
        }
      >
        <div className="compact-data-list">
          {headerEntries.slice(0, 6).map(([key, value]) => (
            <div key={key}>
              <span>{key}</span>
              <code>{value}</code>
            </div>
          ))}
          {headerEntries.length > 6 && (
            <span className="ellipsis-row">···</span>
          )}
        </div>
      </MetaSection>
      <MetaSection
        title="Query parameters"
        action={
          <button
            type="button"
            className="view-all-button"
            onClick={() => setDetailTab("query")}
          >
            View all
          </button>
        }
      >
        <div className="compact-data-list">
          {query && Object.entries(query).length > 0 ? (
            Object.entries(query)
              .slice(0, 4)
              .map(([key, value]) => (
                <div key={key}>
                  <span>{key}</span>
                  <code>{value}</code>
                </div>
              ))
          ) : (
            <span className="metadata-muted">No query parameters</span>
          )}
        </div>
      </MetaSection>
    </>
  );

  const renderDetailTab = () => {
    if (detailTab === "headers")
      return (
        <MetaSection title="All headers">
          <JsonViewer value={selected?.headers} />
        </MetaSection>
      );
    if (detailTab === "query")
      return (
        <MetaSection title="All query parameters">
          <JsonViewer
            value={selected?.query}
            emptyLabel="No query parameters"
          />
        </MetaSection>
      );
    if (detailTab === "raw")
      return (
        <MetaSection title="Raw request">
          <pre className="raw-request">
            {selected?.method} {selected?.path}\n
            {selectedHeaders ? JSON.stringify(selectedHeaders, null, 2) : ""}
            \n\n{selected?.body ?? ""}
          </pre>
        </MetaSection>
      );
    return renderOverview();
  };

  return (
    <main className="app-shell">
      <div
        ref={workbenchRef}
        className="reference-workbench"
        style={workbenchStyle}
      >
        <AppRail />
        <RequestHistory
          requests={requests}
          selectedId={selected?.id}
          freshRequestId={freshRequestId}
          loading={historyLoading}
          onSelect={selectRequest}
          inboxId={inboxId}
          webhookUrl={webhookUrl}
          connection={connection}
          copied={copyTarget === "url"}
          onCopyUrl={() => copyText(webhookUrl, "url")}
        />
        <PaneResizeHandle
          label="Resize inbox pane"
          onPointerDown={(event) => handleResizePointerDown("inbox", event)}
          onKeyDown={(event) => handleResizeKeyDown("inbox", event)}
        />
        <section className="request-pane">
          {error && (
            <div className="error-banner app-error">
              <Icon name="x" className="h-4 w-4" />
              {error}
              <button
                type="button"
                aria-label="Dismiss error"
                onClick={() => setError(null)}
              >
                <Icon name="x" className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {selected ? (
            <>
              <div className="request-heading">
                <div>
                  <div className="request-heading-title">
                    <span
                      className={`method-text ${methodClass(selected.method)}`}
                    >
                      {selected.method}
                    </span>
                    <h1>{selected.path}</h1>
                  </div>
                  <p>
                    {formatDate(getRequestTime(selected))}
                    <span>·</span>
                    <span>2s ago</span>
                  </p>
                </div>
                <StatusPill connection={connection} />
              </div>
              <TabBar
                active={detailTab}
                onChange={(tab) => setDetailTab(tab as DetailTab)}
                tabs={[
                  { id: "overview", label: "Overview" },
                  { id: "headers", label: `Headers (${headerEntries.length})` },
                  {
                    id: "query",
                    label: `Query (${query ? Object.keys(query).length : 0})`,
                  },
                  { id: "raw", label: "Raw" },
                ]}
              />
              <div className="request-content">
                {renderDetailTab()}
                <div className="replay-section">
                  <div className="section-title">
                    <span>Replay request</span>
                    <Icon name="send" className="h-3.5 w-3.5" />
                  </div>
                  <div className="replay-input">
                    <input
                      type="url"
                      value={replayUrl}
                      onChange={(event) => setReplayUrl(event.target.value)}
                      placeholder="https://your-endpoint.com/webhook"
                      aria-label="Replay destination URL"
                    />
                    <button
                      type="button"
                      className="primary-button compact-button"
                      onClick={replayRequest}
                      disabled={!replayUrl || replaying}
                    >
                      {replaying ? (
                        <Icon name="loader" className="h-4 w-4 animate-spin" />
                      ) : (
                        <Icon name="arrow-up-right" className="h-4 w-4" />
                      )}
                      {uiCopy.replay}
                    </button>
                  </div>
                  {replayResult && (
                    <div
                      className={`result-note ${replayResult.success ? "result-success" : "result-error"}`}
                    >
                      <Icon
                        name={replayResult.success ? "check" : "x"}
                        className="h-4 w-4"
                      />
                      {replayResult.message}
                    </div>
                  )}
                </div>
                {hasStripeSignature && (
                  <div className="verify-section">
                    <div className="section-title">
                      <span>Verify Stripe signature</span>
                      <Icon name="shield" className="h-3.5 w-3.5" />
                    </div>
                    <p>
                      Check the captured payload against your signing secret.
                    </p>
                    <div className="replay-input">
                      <input
                        type="password"
                        value={stripeSecret}
                        onChange={(event) =>
                          setStripeSecret(event.target.value)
                        }
                        placeholder="whsec_..."
                        aria-label="Stripe webhook signing secret"
                      />
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={verifySignature}
                        disabled={!stripeSecret || verifying}
                      >
                        {verifying ? (
                          <Icon
                            name="loader"
                            className="h-4 w-4 animate-spin"
                          />
                        ) : (
                          "Verify"
                        )}
                      </button>
                    </div>
                    {verifyResult && (
                      <div
                        className={`result-note ${verifyResult.valid ? "result-success" : "result-error"}`}
                      >
                        <Icon
                          name={verifyResult.valid ? "check" : "x"}
                          className="h-4 w-4"
                        />
                        {verifyResult.valid
                          ? "Signature is valid"
                          : (verifyResult.reason ?? "Signature mismatch")}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="request-empty">
              <p className="editorial-kicker">Request details</p>
              <h1>Send a test request</h1>
              <p>
                Send directly to any endpoint without adding it to this inbox.
              </p>
              <ManualRequestForm onSend={sendManualRequest} />
            </div>
          )}
        </section>
        <PaneResizeHandle
          label="Resize request details pane"
          onPointerDown={(event) => handleResizePointerDown("request", event)}
          onKeyDown={(event) => handleResizeKeyDown("request", event)}
        />
        <section className="payload-pane">
          {selected ? (
            <>
              <div className="payload-top">
                <TabBar
                  active={payloadTab}
                  onChange={(tab) => setPayloadTab(tab as PayloadTab)}
                  tabs={[
                    { id: "payload", label: "Payload" },
                    { id: "schema", label: "Schema" },
                  ]}
                />
                <CopyButton
                  copied={copyTarget === "generic"}
                  onClick={() => copyText(selected.body ?? "", "generic")}
                />
              </div>
              <div className="payload-viewer">
                {payloadTab === "payload" ? (
                  <JsonViewer
                    value={selected.body}
                    emptyLabel="No body received"
                  />
                ) : (
                  <SchemaViewer value={selected.body} />
                )}
              </div>
              <div className="payload-footer">
                <span>
                  <span className="live-select-dot" />
                  {selected.body ? "Valid JSON" : "Empty body"}
                </span>
                <span>{formatBytes(selected.body)}</span>
                <span>
                  {selected.body
                    ? `${selected.body.split(/\r?\n/).length} lines`
                    : "0 lines"}
                </span>
                <span className="payload-format">Pretty⌄</span>
              </div>
            </>
          ) : (
            <div className="payload-empty">
              <div className="payload-empty-mark">
                <Icon name="code" className="h-5 w-5" />
              </div>
              <p className="editorial-kicker">Request inspector</p>
              <h1>{uiCopy.emptyInspector}</h1>
              <p>{uiCopy.emptyInspectorDescription}</p>
              <div className="curl-inline">
                <div>
                  <span className="mono-muted">Quick test</span>
                  <code>{curlCommand}</code>
                </div>
                <CopyButton
                  copied={copyTarget === "curl"}
                  onClick={() => copyText(curlCommand, "curl")}
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default App;
