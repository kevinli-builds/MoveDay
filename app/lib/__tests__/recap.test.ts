import { describe, expect, it } from 'vitest'
import { computeRecap, isToured } from '../recap'
import { defaultHunt } from '../storage'
import type { Hunt, Listing } from '../types'

// computeRecap is a pure derivation (the "wrapped" card, M5b). These lock the
// counting rules — especially "the Nth one you saw" — against regressions.

function listing(over: Partial<Listing> & { id: string; createdAt: string }): Listing {
  return {
    status: 'saved',
    name: over.id,
    photoIds: [],
    commutes: [],
    ...over,
  }
}

function hunt(listings: Listing[]): Hunt {
  return { ...defaultHunt(), listings }
}

describe('isToured', () => {
  it('counts a place with tour notes or a post-touring status', () => {
    expect(isToured(listing({ id: 'a', createdAt: '2026-01-01', status: 'saved' }))).toBe(false)
    expect(isToured(listing({ id: 'b', createdAt: '2026-01-01', status: 'toured' }))).toBe(true)
    expect(isToured(listing({ id: 'c', createdAt: '2026-01-01', status: 'saved', tour: { rating: 4 } }))).toBe(true)
    expect(isToured(listing({ id: 'd', createdAt: '2026-01-01', status: 'signed' }))).toBe(true)
  })
})

describe('computeRecap', () => {
  it('handles an empty hunt', () => {
    const r = computeRecap(defaultHunt())
    expect(r).toEqual({ saved: 0, toured: 0 })
  })

  it('reports "the Nth one you saw" by creation order', () => {
    // Insert out of order to prove it sorts by createdAt, not array position.
    const r = computeRecap(
      hunt([
        listing({ id: '2nd', createdAt: '2026-02-01', status: 'rejected', tour: { rating: 2 } }),
        listing({ id: '3rd', createdAt: '2026-03-01', status: 'signed', tour: { rating: 5, touredAt: '2026-03-05' } }),
        listing({ id: '1st', createdAt: '2026-01-01', status: 'toured', tour: { rating: 3 } }),
      ]),
    )
    expect(r.saved).toBe(3)
    expect(r.toured).toBe(3)
    expect(r.signed?.name).toBe('3rd')
    expect(r.signed?.ordinalSeen).toBe(3)
    expect(r.signed?.ordinalToured).toBe(3)
    expect(r.signed?.daysHunting).toBe(63) // 2026-01-01 → 2026-03-05
    expect(r.topRated).toEqual({ name: '3rd', value: 5 })
  })

  it('derives cheapest, best value, and average toured rent', () => {
    const r = computeRecap(
      hunt([
        listing({ id: 'big', createdAt: '2026-01-01', status: 'toured', rentMonthly: 3000, sqft: 1000 }), // $3.00/sqft
        listing({ id: 'small', createdAt: '2026-01-02', status: 'toured', rentMonthly: 2000, sqft: 500 }), // $4.00/sqft
        listing({ id: 'saved-only', createdAt: '2026-01-03', status: 'saved', rentMonthly: 1000, sqft: 200 }), // $5.00, not toured
      ]),
    )
    expect(r.cheapest).toEqual({ name: 'saved-only', value: 1000 })
    expect(r.bestValue).toEqual({ name: 'big', value: 3 })
    expect(r.avgRentToured).toBe(2500) // (3000 + 2000) / 2, saved-only excluded
  })

  it('omits the signed block when nothing is signed', () => {
    const r = computeRecap(hunt([listing({ id: 'a', createdAt: '2026-01-01', status: 'touring' })]))
    expect(r.signed).toBeUndefined()
    expect(r.toured).toBe(0)
  })
})
