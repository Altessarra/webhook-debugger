import { Icon } from "../components/Icon";

export function Code({
  webhookUrl,
  curlCommand,
  copied,
  onCopy,
}: {
  webhookUrl: string;
  curlCommand: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <section className="route-page code-page">
      <div className="route-page-header">
        <p className="editorial-kicker">Integration guide</p>
        <h1>Send a request here.</h1>
        <p>
          Point a webhook provider or a local script at your inbox endpoint and
          watch the request arrive in real time.
        </p>
      </div>
      <div className="code-card">
        <div className="code-card-heading">
          <span>Inbox URL</span>
          <span className="mono-muted">POST</span>
        </div>
        <code>{webhookUrl || "Create an inbox to generate an endpoint"}</code>
      </div>
      <div className="code-card">
        <div className="code-card-heading">
          <span>Quick test</span>
          <button
            type="button"
            className="copy-button page-copy-button"
            onClick={onCopy}
            disabled={!curlCommand}
          >
            <Icon
              name={copied ? "check" : "clipboard"}
              className="h-3.5 w-3.5"
            />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <code>
          {curlCommand ||
            'curl -X POST YOUR_INBOX_URL -H "Content-Type: application/json" -d \'{"hello":"world"}\''}
        </code>
      </div>
    </section>
  );
}
