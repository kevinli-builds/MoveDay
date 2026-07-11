import { describe, expect, it } from 'vitest'
import { defaultHunt, normalizeHunt } from '../storage'
import { dollarsPerSqft } from '../types'

// normalizeHunt is the trust boundary: every hunt (localStorage, import bundle,
// future handoffs) passes through it. Hostile or stale shapes must come out whole.

describe('normalizeHunt', () => {
  it('returns the default hunt for garbage input', () => {
    expect(normalizeHunt(null)).toEqual(defaultHunt())
    expect(normalizeHunt('nope')).toEqual(defaultHunt())
    expect(normalizeHunt(42)).toEqual(defaultHunt())
  })

  it('fills missing collections on a partial hunt', () => {
    const h = normalizeHunt({ v: 1, name: 'Fall move' })
    expect(h.name).toBe('Fall move')
    expect(h.listings).toEqual([])
    expect(h.anchors).toEqual([])
    expect(h.myFurniture).toEqual([])
    expect(h.dealbreakerDefs.length).toBeGreaterThan(0)
  })

  it('coerces a hostile listing into a safe one', () => {
    const h = normalizeHunt({
      listings: [
        {
          name: 'X'.repeat(500),
          status: 'evil',
          url: 'javascript:alert(1)',
          rentMonthly: -50,
          sqft: 'big',
          photoIds: ['a', 7, 'b'],
          commutes: [{ anchorId: 'work', driveMin: 12 }, { driveMin: 5 }, 'junk'],
          tour: { rating: 99, threeWords: 'nice' },
        },
      ],
    })
    const l = h.listings[0]
    expect(l.name.length).toBeLessThanOrEqual(120)
    expect(l.status).toBe('saved')
    expect(l.url).toBeUndefined() // javascript: blocked
    expect(l.rentMonthly).toBeUndefined() // negative rejected
    expect(l.sqft).toBeUndefined()
    expect(l.photoIds).toEqual(['a', 'b'])
    expect(l.commutes).toEqual([{ anchorId: 'work', driveMin: 12, walkMin: undefined, transitMin: undefined }])
    expect(l.tour?.rating).toBeUndefined() // out-of-range rating dropped
    expect(l.tour?.threeWords).toBe('nice')
  })

  it('sanitizes furniture colors (SVG-sink safety)', () => {
    const h = normalizeHunt({
      myFurniture: [{ name: 'Sofa', w: 200, h: 90, color: 'url(https://evil.example/x)' }],
    })
    expect(h.myFurniture[0].color).toMatch(/^#/)
  })

  it('round-trips a valid hunt unchanged in the fields that matter', () => {
    const input = {
      v: 1,
      name: 'Move',
      anchors: [{ id: 'a1', name: 'Work', address: '1 Main St', lat: 40.7, lon: -74 }],
      dealbreakerDefs: [{ id: 'laundry', label: 'In-unit laundry' }],
      myFurniture: [{ id: 'f1', name: 'Sofa', type: 'sofa', w: 220, h: 95, color: '#3d6b9e' }],
      listings: [
        {
          id: 'l1',
          createdAt: '2026-07-11T00:00:00.000Z',
          status: 'toured',
          name: 'Maple St 2BR',
          rentMonthly: 2400,
          sqft: 800,
          photoIds: [],
          commutes: [],
          tour: { rating: 4, threeWords: 'bright, small kitchen', touredAt: '2026-07-10' },
        },
      ],
    }
    const h = normalizeHunt(JSON.parse(JSON.stringify(input)))
    expect(h.anchors[0]).toEqual(input.anchors[0])
    expect(h.myFurniture[0]).toMatchObject({ id: 'f1', w: 220, h: 95, color: '#3d6b9e' })
    expect(h.listings[0]).toMatchObject({ id: 'l1', status: 'toured', rentMonthly: 2400 })
    expect(h.listings[0].tour?.rating).toBe(4)
  })
})

describe('dollarsPerSqft', () => {
  it('derives $/sqft only when both inputs exist', () => {
    const base = { id: 'x', createdAt: '', status: 'saved' as const, name: '', photoIds: [], commutes: [] }
    expect(dollarsPerSqft({ ...base, rentMonthly: 2400, sqft: 800 })).toBeCloseTo(3)
    expect(dollarsPerSqft({ ...base, rentMonthly: 2400 })).toBeUndefined()
    expect(dollarsPerSqft({ ...base, sqft: 0, rentMonthly: 100 })).toBeUndefined()
  })
})
