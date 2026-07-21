import { describe, expect, it } from 'vitest'

import { extractSafePlan } from '../planGeometry'
import { FALLBACK_COLOR } from '../sanitize'

const room = (o: Record<string, unknown> = {}) => ({ id: 'r1', name: 'Living', x: 0, y: 0, w: 400, h: 300, color: '#3d6b9e', ...o })

describe('extractSafePlan — trust boundary', () => {
  it('extracts rooms, doors, and furniture from a well-formed plan', () => {
    const safe = extractSafePlan({
      width: 1200,
      height: 900,
      rooms: [room()],
      doors: [{ x: 0, y: 150, length: 90, orientation: 'v', type: 'swing' }],
      furniture: [{ x: 50, y: 50, w: 220, h: 95, rotation: 0, color: '#c9a87c', shape: 'rect' }],
    })
    expect(safe).not.toBeNull()
    expect(safe!.rooms).toHaveLength(1)
    expect(safe!.doors).toHaveLength(1)
    expect(safe!.furniture).toHaveLength(1)
    expect(safe!.bbox).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 300 })
  })

  it('sanitizes hostile colours (url() exfiltration → fallback)', () => {
    const safe = extractSafePlan({
      rooms: [room({ color: 'url(https://evil.example/track.png)' })],
      furniture: [{ x: 0, y: 0, w: 10, h: 10, rotation: 0, color: 'expression(alert(1))', shape: 'rect' }],
    })
    expect(safe!.rooms[0].color).toBe(FALLBACK_COLOR)
    expect(safe!.furniture[0].color).toBe(FALLBACK_COLOR)
  })

  it('coerces non-finite / non-numeric coordinates to safe numbers', () => {
    // A valid room keeps the plan drawable; the hostile one is what we assert on.
    const safe = extractSafePlan({
      rooms: [room(), { id: 'bad', x: Infinity, y: NaN, w: 'huge', h: -50, color: '#000' }],
    })
    const r = safe!.rooms.find((x) => x.id === 'bad')!
    expect(Number.isFinite(r.x)).toBe(true)
    expect(Number.isFinite(r.y)).toBe(true)
    expect(r.y).toBe(0) // NaN → 0
    expect(r.w).toBe(0) // non-number → 0
    expect(r.h).toBe(0) // negative size → 0
  })

  it('clamps absurd coordinates instead of trusting them', () => {
    const safe = extractSafePlan({ rooms: [room({ x: 1e12, w: 500 })] })
    expect(safe!.rooms[0].x).toBe(100_000) // LIMIT
  })

  it('keeps polygon points (≥3) and uses them for the bounding box', () => {
    const safe = extractSafePlan({
      rooms: [room({ x: 0, y: 0, w: 100, h: 100, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 100, y: 150 }] })],
    })
    expect(safe!.rooms[0].points).toHaveLength(3)
    expect(safe!.bbox).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 150 })
  })

  it('drops degenerate polygons (<3 points) back to the rectangle', () => {
    const safe = extractSafePlan({ rooms: [room({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })] })
    expect(safe!.rooms[0].points).toBeUndefined()
  })

  it('normalizes door/furniture enums to safe defaults', () => {
    const safe = extractSafePlan({
      rooms: [room()],
      doors: [{ x: 0, y: 0, length: 90, orientation: 'diagonal', type: 'trapdoor' }],
      furniture: [{ x: 0, y: 0, w: 10, h: 10, rotation: 0, shape: 'blob' }],
    })
    expect(safe!.doors[0].orientation).toBe('h')
    expect(safe!.doors[0].type).toBe('swing')
    expect(safe!.furniture[0].round).toBe(false)
  })

  it('returns null when there is nothing drawable', () => {
    expect(extractSafePlan(null)).toBeNull()
    expect(extractSafePlan('a string')).toBeNull()
    expect(extractSafePlan({ rooms: [], furniture: [] })).toBeNull()
    expect(extractSafePlan({ rooms: 'not an array' })).toBeNull()
    // Rooms all zero-size at the origin → no extent
    expect(extractSafePlan({ rooms: [room({ w: 0, h: 0 })] })).toBeNull()
  })

  it('survives a plan with the wrong-typed arrays', () => {
    const safe = extractSafePlan({
      rooms: [room(), 'garbage', 42, null, { name: 'no coords' }],
      doors: 'nope',
      furniture: [{ x: 0, y: 0, w: 0, h: 0 }], // zero-size furniture dropped
    })
    expect(safe!.rooms.length).toBe(2) // valid room + the coordless one (defaults to 0)
    expect(safe!.doors).toEqual([])
    expect(safe!.furniture).toEqual([])
  })

  it('caps element counts against a hostile giant plan', () => {
    const rooms = Array.from({ length: 5000 }, (_, i) => room({ id: `r${i}`, x: i, y: 0, w: 10, h: 10 }))
    const safe = extractSafePlan({ rooms })
    expect(safe!.rooms.length).toBeLessThanOrEqual(200)
  })

  it('grows the bounding box to include furniture beyond the rooms', () => {
    const safe = extractSafePlan({
      rooms: [room({ x: 0, y: 0, w: 100, h: 100 })],
      furniture: [{ x: 200, y: 200, w: 100, h: 100, rotation: 0, color: '#000', shape: 'rect' }],
    })
    expect(safe!.bbox).toEqual({ minX: 0, minY: 0, maxX: 300, maxY: 300 })
  })
})
