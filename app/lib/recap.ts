// Hunt retrospective — the "wrapped" card (FABLE_BRIEF §5 M5b). A pure
// derivation over the hunt, unit-tested like dollarsPerSqft / commute math.
// No mutation, no I/O — just stats the RecapDialog renders.

import type { Hunt, Listing } from './types'
import { dollarsPerSqft } from './types'

// Statuses that mean you actually walked the place (or got further).
const TOURED_STATUSES = new Set(['toured', 'applied', 'rejected', 'signed'])

export function isToured(l: Listing): boolean {
  return (
    !!l.tour?.touredAt ||
    l.tour?.rating != null ||
    (l.tour?.threeWords?.trim().length ?? 0) > 0 ||
    TOURED_STATUSES.has(l.status)
  )
}

export interface NamedValue {
  name: string
  value: number
}

export interface Recap {
  saved: number // total listings tracked
  toured: number // of those, ones you actually toured
  signed?: {
    name: string
    ordinalSeen: number // 1-based position by createdAt — "the Nth one you saw"
    ordinalToured?: number // 1-based among toured listings, if it was toured
    daysHunting?: number // first listing → signing, in whole days
  }
  topRated?: NamedValue // highest gut rating (value = 1..5)
  cheapest?: NamedValue // lowest monthly rent
  bestValue?: NamedValue // lowest $/sqft (value rounded to cents)
  avgRentToured?: number // mean monthly rent across toured listings that list rent
}

function byCreatedAt(a: Listing, b: Listing): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
}

// Whole days between two ISO strings (>= 0), or undefined if either is unparseable.
function daysBetween(fromISO: string, toISO: string): number | undefined {
  const from = Date.parse(fromISO)
  const to = Date.parse(toISO)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return undefined
  return Math.max(0, Math.round((to - from) / 86_400_000))
}

export function computeRecap(hunt: Hunt): Recap {
  const listings = hunt.listings
  const byDate = [...listings].sort(byCreatedAt)
  const toured = byDate.filter(isToured)

  const recap: Recap = { saved: listings.length, toured: toured.length }

  // Signed place → its ordinal among everything seen, and how long the hunt ran.
  const signed = byDate.find((l) => l.status === 'signed')
  if (signed) {
    const ordinalSeen = byDate.findIndex((l) => l.id === signed.id) + 1
    const ordinalTouredIdx = toured.findIndex((l) => l.id === signed.id)
    const signedAt = signed.tour?.touredAt || signed.createdAt
    recap.signed = {
      name: signed.name,
      ordinalSeen,
      ordinalToured: ordinalTouredIdx >= 0 ? ordinalTouredIdx + 1 : undefined,
      daysHunting: byDate[0] ? daysBetween(byDate[0].createdAt, signedAt) : undefined,
    }
  }

  // Top gut rating (ties → first seen).
  for (const l of byDate) {
    const r = l.tour?.rating
    if (r != null && (!recap.topRated || r > recap.topRated.value)) {
      recap.topRated = { name: l.name, value: r }
    }
  }

  // Cheapest rent + best $/sqft.
  for (const l of listings) {
    if (l.rentMonthly != null && (!recap.cheapest || l.rentMonthly < recap.cheapest.value)) {
      recap.cheapest = { name: l.name, value: l.rentMonthly }
    }
    const psf = dollarsPerSqft(l)
    if (psf != null && (!recap.bestValue || psf < recap.bestValue.value)) {
      recap.bestValue = { name: l.name, value: Math.round(psf * 100) / 100 }
    }
  }

  // Average rent across toured places that list one.
  const touredRents = toured.map((l) => l.rentMonthly).filter((r): r is number => r != null)
  if (touredRents.length > 0) {
    recap.avgRentToured = Math.round(touredRents.reduce((a, b) => a + b, 0) / touredRents.length)
  }

  return recap
}
