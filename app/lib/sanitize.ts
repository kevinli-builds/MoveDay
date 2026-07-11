// Trust-boundary helpers, following Furnisher's lib/sanitize.ts: anything that
// reaches an SVG fill / CSS background or an href must pass through here.
// Handoff payloads and pasted plan JSON are attacker-controllable.

// Hex colors and a small named allowlist only — blocks url(...) exfiltration.
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const NAMED = new Set(['transparent', 'none', 'white', 'black'])

export const FALLBACK_COLOR = '#c9a87c'

export function safeColor(raw: unknown): string {
  if (typeof raw !== 'string') return FALLBACK_COLOR
  const c = raw.trim()
  if (HEX.test(c) || NAMED.has(c.toLowerCase())) return c
  return FALLBACK_COLOR
}

// Only allow http(s) links — blocks javascript:, data:, etc. Returns a safe
// absolute URL or null. (Same contract as Furnisher's lib/url.ts.)
export function safeUrl(raw: string | undefined | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const u = new URL(candidate)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}
