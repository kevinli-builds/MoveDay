// ── MoveDay data model ───────────────────────────────────────────
// See FABLE_BRIEF.md §3. The root persisted object is a Hunt; everything
// loaded from storage or an import passes through normalizeHunt() (storage.ts).

export type ListingStatus = 'saved' | 'touring' | 'toured' | 'applied' | 'rejected' | 'signed'

export const LISTING_STATUSES: ListingStatus[] = [
  'saved',
  'touring',
  'toured',
  'applied',
  'rejected',
  'signed',
]

// A place your life happens — commute times are computed against these.
export interface Anchor {
  id: string
  name: string // "Work", "Gym"
  address: string
  lat?: number // geocoded once via Nominatim, cached here
  lon?: number
}

export interface CommuteEntry {
  anchorId: string
  driveMin?: number // OSRM estimate — always rendered with "est."
  walkMin?: number // OSRM estimate
  transitMin?: number // manual — user reads it off the Google Maps deep link
}

export interface TourNotes {
  rating?: 1 | 2 | 3 | 4 | 5
  threeWords?: string // "bright, tiny kitchen, street noise"
  touredAt?: string // ISO date
  dealbreakers?: Record<string, boolean> // keyed by DealbreakerDef id
}

// Furnisher's furniture-template shape, carried verbatim so handoffs
// round-trip without translation (see FABLE_BRIEF.md §4).
export interface FurnTemplate {
  id: string
  name: string
  type: string
  w: number // cm
  h: number // cm
  color: string
  shape?: 'rect' | 'round'
  url?: string
  price?: number
  group?: string
}

export interface Listing {
  id: string
  createdAt: string
  status: ListingStatus
  name: string // "Maple St 2BR"
  address?: string
  url?: string // validated through safeUrl before rendering as a link
  rentMonthly?: number // USD
  sqft?: number
  beds?: number
  baths?: number
  floor?: number
  hasElevator?: boolean
  availableFrom?: string // ISO date
  notes?: string
  photoIds: string[] // IndexedDB keys — blobs never touch localStorage
  commutes: CommuteEntry[]
  tour?: TourNotes
  planJson?: unknown // a Furnisher Partial<Plan>; UNTRUSTED until normalized
  pinned?: boolean
}

export interface DealbreakerDef {
  id: string
  label: string
}

export interface Hunt {
  v: 1
  name: string // "Fall 2026 move"
  anchors: Anchor[]
  dealbreakerDefs: DealbreakerDef[]
  myFurniture: FurnTemplate[]
  listings: Listing[]
}

export function dollarsPerSqft(l: Listing): number | undefined {
  if (!l.rentMonthly || !l.sqft || l.sqft <= 0) return undefined
  return l.rentMonthly / l.sqft
}
