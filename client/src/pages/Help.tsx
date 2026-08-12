export function Help() {
  return (
    <section className="route-page help-page">
      <div className="route-page-header">
        <p className="editorial-kicker">Field notes</p>
        <h1>Keep the signal.</h1>
        <p>
          Use an inbox URL as the destination for your provider, then inspect
          headers, query parameters, and payloads as they arrive.
        </p>
      </div>
      <div className="help-list">
        <div>
          <span>01</span>
          <p>
            <strong>Copy the inbox URL.</strong>
            <br />
            Use the URL in your webhook provider’s endpoint field.
          </p>
        </div>
        <div>
          <span>02</span>
          <p>
            <strong>Send a test event.</strong>
            <br />
            The request list updates over WebSockets while the app is open.
          </p>
        </div>
        <div>
          <span>03</span>
          <p>
            <strong>Inspect or replay.</strong>
            <br />
            Choose a request to view its data or send it to another endpoint.
          </p>
        </div>
      </div>
    </section>
  );
}
