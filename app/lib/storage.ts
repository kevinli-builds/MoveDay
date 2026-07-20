import type {
  Anchor,
  CommuteEntry,
  DealbreakerDef,
  FurnTemplate,
  Hunt,
  Listing,
  ListingStatus,
  TourNotes,
} from './types'
import { LISTING_STATUSES } from './types'
import { safeColor, safeUrl } from './sanitize'

const KEY = 'moveday.hunt.v1'

export function defaultHunt(): Hunt {
  return {
    v: 1,
    name: 'My hunt',
    anchors: [],
    dealbreakerDefs: [
      { id: 'laundry', label: 'In-unit laundry' },
      { id: 'dishwasher', label: 'Dishwasher' },
      { id: 'light', label: 'Natural light' },
      { id: 'quiet', label: 'Quiet street' },
    ],
    myFurniture: [],
    listings: [],
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined)
const posNum = (v: unknown): number | undefined => {
  const n = num(v)
  return n !== undefined && n >= 0 ? n : undefined
}

function normalizeStatus(v: unknown): ListingStatus {
  return LISTING_STATUSES.includes(v as ListingStatus) ? (v as ListingStatus) : 'saved'
}

function normalizeTour(raw: unknown): TourNotes | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const t = raw as Partial<TourNotes>
  const rating = num(t.rating)
  const out: TourNotes = {
    rating: rating && rating >= 1 && rating <= 5 ? (Math.round(rating) as TourNotes['rating']) : undefined,
    threeWords: str(t.threeWords)?.slice(0, 120),
    touredAt: str(t.touredAt),
    dealbreakers:
      t.dealbreakers && typeof t.dealbreakers === 'object'
        ? Object.fromEntries(
            Object.entries(t.dealbreakers)
              .filter(([, v]) => typeof v === 'boolean')
              .slice(0, 50),
          )
        : undefined,
  }
  return out.rating || out.threeWords || out.touredAt || out.dealbreakers ? out : undefined
}

function normalizeCommutes(raw: unknown): CommuteEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      anchorId: str(c.anchorId) ?? '',
      driveMin: posNum(c.driveMin),
      walkMin: posNum(c.walkMin),
      transitMin: posNum(c.transitMin),
      rough: c.rough === true ? true : undefined,
    }))
    .filter((c) => c.anchorId)
}

function normalizeFurniture(raw: unknown): FurnTemplate[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f, i) => ({
      id: str(f.id) ?? `furn-${i}`,
      name: str(f.name) ?? 'Piece',
      type: str(f.type) ?? 'box',
      w: posNum(f.w) ?? 100,
      h: posNum(f.h) ?? 100,
      color: safeColor(f.color),
      shape: f.shape === 'round' ? ('round' as const) : undefined,
      url: safeUrl(str(f.url)) ?? undefined,
      price: posNum(f.price),
      group: str(f.group),
    }))
}

function normalizeListing(raw: unknown, i: number): Listing | null {
  if (!raw || typeof raw !== 'object') return null
  const l = raw as Record<string, unknown>
  return {
    id: str(l.id) ?? `listing-${i}-${Date.now()}`,
    createdAt: str(l.createdAt) ?? new Date().toISOString(),
    status: normalizeStatus(l.status),
    name: (str(l.name) ?? 'Untitled listing').slice(0, 120),
    address: str(l.address)?.slice(0, 300),
    url: safeUrl(str(l.url)) ?? undefined,
    rentMonthly: posNum(l.rentMonthly),
    sqft: posNum(l.sqft),
    beds: posNum(l.beds),
    baths: posNum(l.baths),
    floor: num(l.floor),
    hasElevator: typeof l.hasElevator === 'boolean' ? l.hasElevator : undefined,
    availableFrom: str(l.availableFrom),
    notes: str(l.notes)?.slice(0, 5000),
    lat: num(l.lat),
    lon: num(l.lon),
    // Cap mirrors MAX_PHOTOS_PER_LISTING (lib/photos.ts) — hostile bundles
    // can't stuff unbounded ids.
    photoIds: Array.isArray(l.photoIds) ? l.photoIds.filter((p): p is string => typeof p === 'string').slice(0, 12) : [],
    commutes: normalizeCommutes(l.commutes),
    tour: normalizeTour(l.tour),
    // Stored opaque; sanitized again at render time by the mini-map (M4).
    planJson: l.planJson && typeof l.planJson === 'object' ? l.planJson : undefined,
    pinned: l.pinned === true,
  }
}

// Coerce any stored/imported hunt shape into a complete Hunt. EVERY hunt
// entering the app passes through here — this is the trust boundary for
// localStorage, export-bundle imports, and future #plan= handoffs.
export function normalizeHunt(parsed: unknown): Hunt {
  if (!parsed || typeof parsed !== 'object') return defaultHunt()
  const h = parsed as Record<string, unknown>
  const base = defaultHunt()
  const anchors: Anchor[] = Array.isArray(h.anchors)
    ? h.anchors
        .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
        .map((a, i) => ({
          id: str(a.id) ?? `anchor-${i}`,
          name: (str(a.name) ?? 'Place').slice(0, 60),
          address: (str(a.address) ?? '').slice(0, 300),
          lat: num(a.lat),
          lon: num(a.lon),
        }))
    : []
  const dealbreakerDefs: DealbreakerDef[] = Array.isArray(h.dealbreakerDefs)
    ? h.dealbreakerDefs
        .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
        .map((d, i) => ({ id: str(d.id) ?? `db-${i}`, label: (str(d.label) ?? '?').slice(0, 60) }))
    : base.dealbreakerDefs
  return {
    v: 1,
    name: (str(h.name) ?? base.name).slice(0, 120),
    anchors,
    dealbreakerDefs,
    myFurniture: normalizeFurniture(h.myFurniture),
    listings: Array.isArray(h.listings)
      ? h.listings.map(normalizeListing).filter((l): l is Listing => l !== null)
      : [],
  }
}

export function loadHunt(): Hunt {
  if (typeof window === 'undefined') return defaultHunt()
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return defaultHunt()
    return normalizeHunt(JSON.parse(raw))
  } catch {
    return defaultHunt()
  }
}

export function saveHunt(hunt: Hunt): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, JSON.stringify(hunt))
  } catch {
    /* quota / private mode — ignore */
  }
}
