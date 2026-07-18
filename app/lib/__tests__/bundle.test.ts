import { describe, it, expect } from 'vitest'
import { normalizeHunt } from '../storage'
import type { Hunt } from '../types'

// The Export button writes JSON.stringify(hunt); Import runs it back through
// normalizeHunt. A populated hunt must survive that round trip unchanged —
// otherwise backups silently lose data.
describe('export → import round trip', () => {
  const hunt: Hunt = {
    v: 1,
    name: 'Fall 2026 move',
    anchors: [{ id: 'a1', name: 'Work', address: '1 Main St', lat: 40.7, lon: -74 }],
    dealbreakerDefs: [{ id: 'laundry', label: 'In-unit laundry' }],
    myFurniture: [
      { id: 'f1', name: 'Grey sofa', type: 'sofa', w: 210, h: 95, color: '#3d6b9e' },
      { id: 'f2', name: 'Round table', type: 'table', w: 90, h: 90, color: '#4a7c59', shape: 'round', price: 250 },
    ],
    listings: [
      {
        id: 'l1',
        createdAt: '2026-07-01T00:00:00.000Z',
        status: 'toured',
        name: 'Maple St 2BR',
        url: 'https://example.com/listing',
        rentMonthly: 2400,
        sqft: 800,
        photoIds: [],
        commutes: [{ anchorId: 'a1', driveMin: 20 }],
        tour: { rating: 4, threeWords: 'bright, tiny kitchen', touredAt: '2026-07-02' },
        planJson: { rooms: [{ id: 'r1', x: 0, y: 0, w: 400, h: 300 }] },
        pinned: true,
      },
    ],
  }

  it('preserves furniture, listings, anchors, and tour notes', () => {
    const restored = normalizeHunt(JSON.parse(JSON.stringify(hunt)))
    expect(restored).toEqual(hunt)
  })

  it('imports a hostile bundle without crashing (trust boundary)', () => {
    const restored = normalizeHunt({
      name: 42,
      myFurniture: [{ name: 'x', w: -5, color: 'url(javascript:alert(1))' }],
      listings: [null, { name: 'ok', url: 'javascript:alert(1)' }],
    })
    expect(restored.myFurniture[0].w).toBe(100) // negative width → default
    expect(restored.myFurniture[0].color).not.toContain('url')
    expect(restored.listings).toHaveLength(1)
    expect(restored.listings[0].url).toBeUndefined()
  })
})
