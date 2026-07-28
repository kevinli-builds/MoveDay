// Client-side, bring-your-own-key Claude call for the AI paste-parse feature
// (FABLE_BRIEF §5 M5a). The user's key lives only in their browser
// (localStorage) and is sent directly to Anthropic with the browser-access
// header — nothing touches a MoveDay server (there isn't one). Adapted from
// Furnisher's app/lib/anthropic.ts; cheapest model, claude-haiku-4-5, is plenty
// for pulling a few fields out of short listing text.

import { safeUrl } from './sanitize'
import type { Listing } from './types'

const KEY = 'moveday.anthropicKey'
const MODEL = 'claude-haiku-4-5'

export function getApiKey(): string {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(KEY) || ''
}
export function setApiKey(k: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(KEY, k.trim())
}
export function clearApiKey(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(KEY)
}
export function hasApiKey(): boolean {
  return getApiKey().length > 0
}

async function callClaude(system: string, userText: string, maxTokens: number): Promise<string> {
  const key = getApiKey()
  if (!key) throw new Error('Add your Anthropic API key first.')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    }),
  })
  if (!res.ok) {
    let msg = `Claude request failed (${res.status})`
    try {
      const j = await res.json()
      msg = (j?.error?.message as string) || msg
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new Error(msg)
  }
  const json = await res.json()
  return ((json.content as { type: string; text?: string }[]) || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n')
}

// The model wraps JSON in prose or code fences often enough to be worth slicing
// to the outermost braces before parsing.
function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned
  return JSON.parse(slice) as T
}

// Only the fields worth pulling out of a rental listing. Status is deliberately
// excluded — that's the user's own workflow state, not something in the text.
export type ParsedListing = Partial<
  Pick<Listing, 'name' | 'address' | 'url' | 'rentMonthly' | 'sqft' | 'beds' | 'baths' | 'availableFrom'>
>

const str = (v: unknown, cap: number): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s.slice(0, cap) : undefined
}
const posNum = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

// Coerce the model's JSON into a clean partial. Every field is validated; the
// URL passes through safeUrl (http(s) only), and the whole thing gets a second
// pass through normalizeHunt when the listing is saved (the real trust
// boundary) — this is just so the form shows sane values.
function normalizeParsed(raw: Record<string, unknown>): ParsedListing {
  const out: ParsedListing = {}
  const name = str(raw.name, 120)
  if (name) out.name = name
  const address = str(raw.address, 300)
  if (address) out.address = address
  const url = safeUrl(str(raw.url, 2000))
  if (url) out.url = url
  const rent = posNum(raw.rentMonthly)
  if (rent !== undefined) out.rentMonthly = Math.round(rent)
  const sqft = posNum(raw.sqft)
  if (sqft !== undefined) out.sqft = Math.round(sqft)
  const beds = posNum(raw.beds)
  if (beds !== undefined) out.beds = beds
  const baths = posNum(raw.baths)
  if (baths !== undefined) out.baths = baths
  const avail = str(raw.availableFrom, 10)
  if (avail && /^\d{4}-\d{2}-\d{2}$/.test(avail)) out.availableFrom = avail
  return out
}

// Extract listing fields from pasted free-form text (a Craigslist post, a Zillow
// blurb, a landlord's email). Returns only the fields it found — the "paste
// magic without the scraping" (FABLE_BRIEF §9: never scrape listing sites).
export async function parseListingText(raw: string): Promise<ParsedListing> {
  const system = [
    'You extract structured fields from a rental/apartment listing that the user pasted as free-form text.',
    'Return ONLY JSON, no prose, in this exact shape (omit any field you cannot find — do not guess):',
    '{"name"?:string,"address"?:string,"url"?:string,"rentMonthly"?:number,"sqft"?:number,"beds"?:number,"baths"?:number,"availableFrom"?:string}',
    'name: a short label for the place (e.g. "Maple St 2BR") — invent a concise one from the street or neighborhood if the listing has no title.',
    'rentMonthly: monthly rent as a plain number in US dollars (no symbols/commas); if only weekly or annual rent is given, convert to monthly.',
    'sqft: interior square footage as a plain number. beds/baths: numbers (baths may be fractional, e.g. 1.5). Studios have beds = 0.',
    'availableFrom: an ISO date YYYY-MM-DD only if an explicit move-in/available date is stated; otherwise omit it.',
    'url: only if an explicit listing URL appears in the text.',
  ].join(' ')
  const text = await callClaude(system, `Listing text:\n${raw}`, 600)
  return normalizeParsed(parseJson<Record<string, unknown>>(text))
}
