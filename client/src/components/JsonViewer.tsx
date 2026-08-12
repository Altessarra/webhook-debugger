import { useState } from 'react'
import { Icon } from './Icon'
import { parseJsonValue } from '../utils/json'

function JsonTree({ label, value, depth = 0 }: { label?: string; value: unknown; depth?: number }) {
  const isObject = typeof value === 'object' && value !== null
  const [open, setOpen] = useState(depth < 1)

  if (!isObject) {
    const rendered = typeof value === 'string' ? `"${value}"` : String(value)
    const valueClass = value === null ? 'json-null' : typeof value === 'string' ? 'json-string' : 'json-number'
    return (
      <div className="json-row" style={{ paddingLeft: `${depth * 16}px` }}>
        {label && <span className="json-key">{label}: </span>}
        <span className={valueClass}>{rendered}</span>
      </div>
    )
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value)

  return (
    <div>
      <button type="button" className="json-toggle" style={{ paddingLeft: `${depth * 16}px` }} onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} className="h-3.5 w-3.5" />
        {label && <span className="json-key">{label}: </span>}
        <span className="json-bracket">{Array.isArray(value) ? '[' : '{'}</span>
        <span className="json-size">{entries.length} {entries.length === 1 ? 'item' : 'items'}</span>
        <span className="json-bracket">{Array.isArray(value) ? ']' : '}'}</span>
      </button>
      {open && entries.map(([key, item]) => <JsonTree key={key} label={Array.isArray(value) ? undefined : key} value={item} depth={depth + 1} />)}
    </div>
  )
}

export function JsonViewer({ value, emptyLabel = 'No data received' }: { value: string | null | undefined; emptyLabel?: string }) {
  const parsed = parseJsonValue(value)
  if (parsed === null) return <p className="empty-data">{emptyLabel}</p>
  if (typeof parsed === 'string') return <pre className="plain-code">{parsed}</pre>
  return <div className="json-viewer"><JsonTree value={parsed} /></div>
}
