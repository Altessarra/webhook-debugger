import { uiCopy } from '../data/content'
import type { CapturedRequest } from '../types/webhook'
import type { ConnectionState } from '../types/webhook'
import { Icon } from './Icon'

function getRequestTime(request: CapturedRequest) {
  return request.createdAt ?? request.created_at ?? Date.now()
}

function relativeTime(timestamp: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 10) return 'now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

function methodClass(method: string) {
  if (method === 'POST') return 'method-post'
  if (method === 'PUT' || method === 'PATCH') return 'method-put'
  if (method === 'DELETE') return 'method-delete'
  return 'method-default'
}

export function RequestHistory({ requests, selectedId, freshRequestId, loading, onSelect, inboxId, webhookUrl, connection, copied, onCopyUrl, onNewInbox }: { requests: CapturedRequest[]; selectedId?: string; freshRequestId?: string | null; loading: boolean; onSelect: (request: CapturedRequest) => void; inboxId: string; webhookUrl: string; connection: ConnectionState; copied: boolean; onCopyUrl: () => void; onNewInbox?: () => void }) {
  return (
    <aside className="inbox-pane">
      <div className="inbox-brand-row"><div className="brand-lockup"><span className="brand-mark brand-mark-small">WD</span><span>{uiCopy.appName}</span></div><Icon name="ellipsis" className="h-4 w-4" /></div>
      <div className="inbox-section inbox-select-section"><div className="inbox-label">Inbox</div><div className="inbox-select"><span className="live-select-dot" />acme-demo<span className="inbox-select-id">{inboxId.slice(0, 4)}</span><Icon name="chevron-down" className="h-3.5 w-3.5" /></div><button type="button" className="add-inbox-button" aria-label="Create another inbox" onClick={() => { if (onNewInbox) onNewInbox(); else { window.localStorage.removeItem('webhook-debugger:inbox-id'); window.location.reload() } }}><Icon name="plus" className="h-4 w-4" /></button></div>
      <div className="inbox-section url-section"><div className="inbox-label">Inbox URL</div><div className="inbox-url-row"><code>{webhookUrl}</code><button type="button" className="inbox-copy-button" onClick={onCopyUrl}>{copied ? 'Copied' : 'Copy'}</button></div></div>
      <div className="request-list-heading"><span>{uiCopy.requestHistory}</span><span className="request-live"><span className="live-select-dot" />{connection === 'connected' ? 'Live' : connection}</span><Icon name="pause" className="h-3.5 w-3.5" /></div>
      <div className="history-list">
        {loading && requests.length === 0 ? <div className="history-state">Loading history...</div> : requests.length === 0 ? <div className="history-state"><span>{uiCopy.waitingForRequests}</span><small>{uiCopy.waitingDescription}</small></div> : requests.map((request) => (
          <button type="button" key={request.id} onClick={() => onSelect(request)} className={`history-row ${selectedId === request.id ? 'history-row-selected' : ''} ${freshRequestId === request.id ? 'history-row-fresh' : ''}`}>
            <div className="history-row-top"><span className={`method-text ${methodClass(request.method)}`}><span className="method-dot" />{request.method}</span><span className="mono-muted">{relativeTime(getRequestTime(request))}</span></div>
            <span className="history-path">{request.path}</span>
          </button>
        ))}
      </div>
      <div className="inbox-footer"><span><span className="live-select-dot" />Connected</span><span>{requests.length} new requests</span></div>
    </aside>
  )
}
