// MoveDay ⇄ Furnisher handoff (FABLE_BRIEF.md §4).
// Plan JSON travels in the URL FRAGMENT, lz-string-compressed — fragments never
// hit server logs or Referer headers, and a rooms-only plan packs to 2–10 KB.

import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import type { FurnTemplate } from './types'

export const FURNISHER_ORIGIN = 'https://furnisher.vercel.app'

// Payloads > this fall back to copy/paste JSON (brief §4 size guard).
export const MAX_PACKED_LENGTH = 30_000

export interface HandoffPayload {
  v: 1
  source: 'moveday' | 'furnisher'
  name: string
  listingId?: string
  plan: Record<string, unknown> // Furnisher Partial<Plan>; receiver normalizes
}

export function packHandoff(payload: HandoffPayload): string {
  return compressToEncodedURIComponent(JSON.stringify(payload))
}

export function unpackHandoff(packed: string): HandoffPayload | null {
  try {
    const json = decompressFromEncodedURIComponent(packed)
    if (!json) return null
    const parsed = JSON.parse(json) as Partial<HandoffPayload>
    if (parsed.v !== 1) return null
    if (parsed.source !== 'moveday' && parsed.source !== 'furnisher') return null
    if (!parsed.plan || typeof parsed.plan !== 'object') return null
    return {
      v: 1,
      source: parsed.source,
      name: typeof parsed.name === 'string' ? parsed.name.slice(0, 120) : 'Imported plan',
      listingId: typeof parsed.listingId === 'string' ? parsed.listingId : undefined,
      plan: parsed.plan as Record<string, unknown>,
    }
  } catch {
    return null
  }
}

// Compose the fit-check plan: the listing's rooms/doors/stairs plus the user's
// furniture staged in a row below the plan's bounding box — a loading dock the
// user drags pieces in from. Furnisher's warnings + Doorway Test do the rest.
export function composeFitCheckPlan(
  listingPlan: Record<string, unknown>,
  myFurniture: FurnTemplate[],
  listingName: string,
): Record<string, unknown> {
  const height = typeof listingPlan.height === 'number' ? listingPlan.height : 900
  const width = typeof listingPlan.width === 'number' ? listingPlan.width : 1200
  const GAP = 20
  let x = GAP
  const rowY = height + GAP
  let rowH = 0
  const staged = myFurniture.map((f, i) => {
    const piece = {
      id: `moveday-${f.id}-${i}`,
      name: f.name,
      type: f.type,
      x,
      y: rowY,
      w: f.w,
      h: f.h,
      rotation: 0,
      color: f.color,
      shape: f.shape,
      url: f.url,
      price: f.price,
    }
    x += f.w + GAP
    rowH = Math.max(rowH, f.h)
    return piece
  })
  const existing = Array.isArray(listingPlan.furniture) ? listingPlan.furniture : []
  return {
    ...listingPlan,
    width: Math.max(width, x),
    height: height + (staged.length ? rowH + GAP * 2 : 0),
    furniture: [...existing, ...staged],
    blueprintUrl: undefined,
    // Furnisher's normalizePlan fills every other field with defaults.
  }
}

export function furnisherImportUrl(payload: HandoffPayload): string | null {
  const packed = packHandoff(payload)
  if (packed.length > MAX_PACKED_LENGTH) return null
  return `${FURNISHER_ORIGIN}/#import=${packed}`
}
