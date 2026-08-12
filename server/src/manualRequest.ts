import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export const manualMethods = ['POST', 'PUT', 'PATCH', 'DELETE'] as const
export type ManualMethod = typeof manualMethods[number]

export type ManualRequestInput = {
  method: string
  targetUrl: string
  headers: string
  body: string
}

const blockedHeaderNames = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function isBlockedIpv4(address: string) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [first, second] = parts
  return first === 0 || first === 10 || first === 127 || first === 169 && second === 254 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168 || first === 100 && second >= 64 && second <= 127 || first === 198 && second >= 18 && second <= 19 || first >= 224
}

export function isBlockedAddress(address: string) {
  const normalized = address.toLowerCase()
  if (isIP(normalized) === 4) return isBlockedIpv4(normalized)
  if (isIP(normalized) !== 6) return false
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true
  if (normalized.startsWith('::ffff:')) return isBlockedIpv4(normalized.slice(7))
  return false
}

function parseHeaders(rawHeaders: string) {
  let headers: unknown
  try {
    headers = JSON.parse(rawHeaders || '{}')
  } catch {
    return { error: 'Headers must be valid JSON' }
  }
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return { error: 'Headers must be a JSON object' }

  const safeHeaders: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (blockedHeaderNames.has(name.toLowerCase())) continue
    if (typeof value !== 'string') return { error: `Header "${name}" must be a string` }
    safeHeaders[name] = value
  }
  return { headers: safeHeaders }
}

export function getSafeHeaders(rawHeaders: string) {
  return parseHeaders(rawHeaders).headers ?? {}
}

export function validateManualRequest(input: ManualRequestInput) {
  if (!input.targetUrl.trim()) return 'Destination URL is required'

  try {
    const destination = new URL(input.targetUrl)
    if (!['http:', 'https:'].includes(destination.protocol)) return 'Destination URL must use http or https'
  } catch {
    return 'Destination URL is invalid'
  }

  if (!manualMethods.includes(input.method as ManualMethod)) return 'Method is not supported'
  const parsedHeaders = parseHeaders(input.headers)
  if (parsedHeaders.error) return parsedHeaders.error
  const contentType = Object.entries(parsedHeaders.headers ?? {}).find(([name]) => name.toLowerCase() === 'content-type')?.[1].toLowerCase() ?? ''
  if (input.body.trim() && contentType.includes('application/json')) {
    try {
      JSON.parse(input.body)
    } catch {
      return 'Payload must be valid JSON'
    }
  }

  return null
}

export async function resolveSafeDestination(targetUrl: string) {
  let destination: URL
  try {
    destination = new URL(targetUrl)
  } catch {
    return { error: 'Destination URL is invalid' as const }
  }

  const hostname = destination.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'metadata.google.internal' || hostname.endsWith('.internal') || isBlockedAddress(hostname)) {
    return { error: 'Destination resolves to a private or internal address' as const }
  }

  try {
    const addresses = isIP(hostname) ? [hostname] : (await lookup(hostname, { all: true, verbatim: true })).map((result) => result.address)
    if (!addresses.length || addresses.some(isBlockedAddress)) return { error: 'Destination resolves to a private or internal address' as const }
  } catch {
    return { error: 'Destination hostname could not be resolved' as const }
  }

  return { destination }
}
