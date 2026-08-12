import { useState } from 'react'
import { Icon } from './Icon'

export type ManualRequestDraft = {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  targetUrl: string
  headers: string
  body: string
}

export type ManualRequestResult = {
  success: boolean
  message: string
  status?: number
  statusText?: string
  responseBody?: string
  responseHeaders?: Record<string, string>
  durationMs?: number
}

export function ManualRequestForm({ onSend }: { onSend: (draft: ManualRequestDraft) => Promise<ManualRequestResult> }) {
  const [method, setMethod] = useState<ManualRequestDraft['method']>('POST')
  const [targetUrl, setTargetUrl] = useState('')
  const [headers, setHeaders] = useState('{\n  "content-type": "application/json"\n}')
  const [body, setBody] = useState('{\n  "hello": "world"\n}')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<ManualRequestResult | null>(null)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSending(true)
    setResult(null)
    try {
      setResult(await onSend({ method, targetUrl, headers, body }))
    } catch {
      setResult({ success: false, message: 'Unable to reach the send service' })
    } finally {
      setSending(false)
    }
  }

  return (
    <form className="manual-request-form" onSubmit={submit}>
      <div className="manual-form-heading"><div><span className="section-title">Send a test request</span><span className="manual-form-note">Direct to your endpoint · not logged</span></div><Icon name="send" className="h-4 w-4" /></div>
      <div className="manual-url-row">
        <select value={method} onChange={(event) => setMethod(event.target.value as ManualRequestDraft['method'])} aria-label="HTTP method">
          <option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
        </select>
        <input type="url" value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} placeholder="https://your-endpoint.com/webhook" aria-label="Destination URL" required />
      </div>
      <label className="manual-field-label" htmlFor="manual-request-headers">Headers · JSON</label>
      <textarea id="manual-request-headers" className="manual-headers-input" value={headers} onChange={(event) => setHeaders(event.target.value)} aria-label="Request headers" spellCheck="false" />
      <label className="manual-field-label" htmlFor="manual-request-body">Body · JSON or raw</label>
      <textarea id="manual-request-body" value={body} onChange={(event) => setBody(event.target.value)} aria-label="Request body" spellCheck="false" />
      <div className="manual-form-footer"><span className="manual-form-note">Response appears below</span><button type="submit" className="primary-button compact-button" disabled={sending}>{sending ? <Icon name="loader" className="h-4 w-4 animate-spin" /> : <Icon name="arrow-up-right" className="h-4 w-4" />}{sending ? 'Sending' : 'Send request'}</button></div>
      {result && <div className={`manual-response ${result.success ? 'manual-response-success' : 'manual-response-error'}`}>
        <div className="result-note"><Icon name={result.success ? 'check' : 'x'} className="h-4 w-4" />{result.success ? `${result.status} ${result.statusText} · ${result.durationMs}ms` : result.message}</div>
        {result.success && <>
          <div className="manual-response-label">Response body</div>
          <pre className="manual-response-body">{result.responseBody || '(empty response)'}</pre>
          {result.responseHeaders && <details className="manual-response-headers"><summary>Response headers</summary><pre>{JSON.stringify(result.responseHeaders, null, 2)}</pre></details>}
        </>}
      </div>}
    </form>
  )
}
