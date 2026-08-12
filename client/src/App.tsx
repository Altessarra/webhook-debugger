import { useState, useEffect, useRef } from 'react'

const API_URL = ''
const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`

type CapturedRequest = {
  id: string
  inbox_id: string
  method: string
  path: string
  headers: string
  body: string | null
  query: string
  created_at: number
}

function App() {
  const [inboxId, setInboxId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [requests, setRequests] = useState<CapturedRequest[]>([])
  const [selected, setSelected] = useState<CapturedRequest | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [replayUrl, setReplayUrl] = useState('')
  const [replaying, setReplaying] = useState(false)
  const [replayResult, setReplayResult] = useState<string | null>(null)
  const [stripeSecret, setStripeSecret] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; reason?: string } | null>(null)

  const createInbox = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/inboxes`, { method: 'POST' })
      const data = await res.json()
      setInboxId(data.id)
    } catch (err) {
      console.error('Failed to create inbox', err)
    } finally {
      setLoading(false)
    }
  }

  const replayRequest = async () => {
    if (!selected || !replayUrl) return
    setReplaying(true)
    setReplayResult(null)
    try {
      const res = await fetch(`${API_URL}/api/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: selected.id, targetUrl: replayUrl }),
      })
      const data = await res.json()
      if (data.success) {
        setReplayResult(`✅ ${data.status} ${data.statusText}`)
      } else {
        setReplayResult(`❌ ${data.error}`)
      }
    } catch (err) {
      setReplayResult(`❌ Failed to reach target`)
    } finally {
      setReplaying(false)
    }
  }

  const verifySignature = async () => {
    if (!selected || !stripeSecret) return
    setVerifying(true)
    setVerifyResult(null)
    try {
      const headers = JSON.parse(selected.headers)
      const signatureHeader = headers['stripe-signature']
      if (!signatureHeader) {
        setVerifyResult({ valid: false, reason: 'No stripe-signature header found' })
        return
      }

      const res = await fetch(`${API_URL}/api/verify-stripe-signature`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: selected.body,
          signatureHeader,
          secret: stripeSecret,
        }),
      })
      const data = await res.json()
      setVerifyResult(data)
    } catch (err) {
      setVerifyResult({ valid: false, reason: 'Verification request failed' })
    } finally {
      setVerifying(false)
    }
  }

  // Connect WebSocket once we have an inbox
  useEffect(() => {
    if (!inboxId) return

    const ws = new WebSocket(`${WS_URL}?inboxId=${inboxId}`)
    wsRef.current = ws

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'new_request') {
        const req = { ...data.request, created_at: data.request.createdAt }
        setRequests((prev) => [req, ...prev])
      }
    }

    ws.onopen = () => console.log('WebSocket connected')
    ws.onerror = (err) => console.error('WebSocket error', err)

    return () => {
      ws.close()
    }
  }, [inboxId])

  if (!inboxId) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center gap-6">
        <h1 className="text-3xl font-bold">Webhook Debugger</h1>
        <p className="text-neutral-400">Create an inbox to start capturing requests</p>
        <button
          onClick={createInbox}
          disabled={loading}
          className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-lg transition"
        >
          {loading ? 'Creating...' : 'Create Inbox'}
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex">
      {/* Sidebar: request list */}
      <div className="w-80 border-r border-neutral-800 flex flex-col">
        <div className="p-4 border-b border-neutral-800">
          <div className="flex items-center justify-between mb-1">
            <h1 className="font-bold">Inbox: {inboxId}</h1>
            {requests.length > 0 && (
              <button
                onClick={() => {
                  setRequests([])
                  setSelected(null)
                }}
                className="text-xs text-neutral-500 hover:text-red-400 transition"
              >
                Clear
              </button>
            )}
          </div>
          <code className="text-xs text-orange-400 break-all">
            {API_URL}/i/{inboxId}
          </code>
        </div>
        <div className="flex-1 overflow-y-auto">
          {requests.length === 0 && (
            <div className="p-4 space-y-3">
              <p className="text-neutral-500 text-sm">Waiting for requests...</p>
              <div className="bg-neutral-900 rounded-lg p-3">
                <p className="text-xs text-neutral-500 mb-1">Try it:</p>
                <code className="text-xs text-orange-400 break-all block mb-2">
                  curl -X POST {API_URL}/i/{inboxId} -H "Content-Type: application/json" -d "{"{"}\"hello\":\"world\"{"}"}"
                </code>
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(
                      `curl -X POST ${API_URL}/i/${inboxId} -H "Content-Type: application/json" -d "{\\"hello\\":\\"world\\"}"`
                    )
                  }
                  className="text-xs text-neutral-400 hover:text-white transition"
                >
                  Copy command
                </button>
              </div>
            </div>
          )}
          {requests.map((req) => (
            <button
              key={req.id}
              onClick={() => {
                setSelected(req)
                setReplayResult(null)
                setVerifyResult(null)
              }}
              className={`w-full text-left p-3 border-b border-neutral-800 hover:bg-neutral-900 transition ${
                selected?.id === req.id ? 'bg-neutral-900' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded">
                  {req.method}
                </span>
                <span className="text-sm text-neutral-300 truncate">{req.path}</span>
              </div>
              <span className="text-xs text-neutral-500">
                {new Date(req.created_at).toLocaleTimeString()}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      <div className="flex-1 p-6 overflow-y-auto">
        {!selected ? (
          <p className="text-neutral-500">Select a request to view details</p>
        ) : (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold mb-2">
                {selected.method} {selected.path}
              </h2>
              <p className="text-neutral-500 text-sm mb-4">
                {new Date(selected.created_at).toLocaleString()}
              </p>
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={replayUrl}
                  onChange={(e) => setReplayUrl(e.target.value)}
                  placeholder="https://your-endpoint.com/webhook"
                  className="flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm placeholder:text-neutral-600 focus:outline-none focus:border-orange-500"
                />
                <button
                  onClick={replayRequest}
                  disabled={!replayUrl || replaying}
                  className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition whitespace-nowrap"
                >
                  {replaying ? 'Sending...' : 'Replay'}
                </button>
              </div>
              {replayResult && (
                <p className="text-sm mt-2 text-neutral-400">{replayResult}</p>
              )}
              {(() => {
                const headers = JSON.parse(selected.headers)
                const hasStripeSignature = !!headers['stripe-signature']
                if (!hasStripeSignature) return null

                return (
                  <div className="mt-4 pt-4 border-t border-neutral-800">
                    <h3 className="text-sm font-semibold text-neutral-400 mb-2">
                      Verify Stripe Signature
                    </h3>
                    <div className="flex gap-2 items-center">
                      <input
                        type="password"
                        value={stripeSecret}
                        onChange={(e) => setStripeSecret(e.target.value)}
                        placeholder="whsec_..."
                        className="flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm placeholder:text-neutral-600 focus:outline-none focus:border-orange-500"
                      />
                      <button
                        onClick={verifySignature}
                        disabled={!stripeSecret || verifying}
                        className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition whitespace-nowrap"
                      >
                        {verifying ? 'Checking...' : 'Verify'}
                      </button>
                    </div>
                    {verifyResult && (
                      <p className={`text-sm mt-2 ${verifyResult.valid ? 'text-green-400' : 'text-red-400'}`}>
                        {verifyResult.valid ? '✅ Signature is valid' : `❌ Invalid: ${verifyResult.reason ?? 'signature mismatch'}`}
                      </p>
                    )}
                  </div>
                )
              })()}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-neutral-400">Headers</h3>
                <button
                  onClick={() => navigator.clipboard.writeText(selected.headers)}
                  className="text-xs text-neutral-500 hover:text-white transition"
                >
                  Copy
                </button>
              </div>
              <pre className="bg-neutral-900 rounded-lg p-4 text-sm overflow-x-auto">
                {JSON.stringify(JSON.parse(selected.headers), null, 2)}
              </pre>
            </div>

            {selected.body && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-neutral-400">Body</h3>
                  <button
                    onClick={() => navigator.clipboard.writeText(selected.body!)}
                    className="text-xs text-neutral-500 hover:text-white transition"
                  >
                    Copy
                  </button>
                </div>
                <pre className="bg-neutral-900 rounded-lg p-4 text-sm overflow-x-auto">
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(selected.body!), null, 2)
                    } catch {
                      return selected.body
                    }
                  })()}
                </pre>
              </div>
            )}

            <div>
              <h3 className="text-sm font-semibold text-neutral-400 mb-2">Query</h3>
              <pre className="bg-neutral-900 rounded-lg p-4 text-sm overflow-x-auto">
                {JSON.stringify(JSON.parse(selected.query), null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App