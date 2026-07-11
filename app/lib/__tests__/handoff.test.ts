import { describe, expect, it } from 'vitest'
import {
  composeFitCheckPlan,
  furnisherImportUrl,
  packHandoff,
  unpackHandoff,
  MAX_PACKED_LENGTH,
} from '../handoff'
import type { HandoffPayload } from '../handoff'

const plan = {
  width: 1200,
  height: 900,
  rooms: [{ id: 'r1', name: 'Living Room', x: 100, y: 100, w: 500, h: 400 }],
  doors: [{ id: 'd1', type: 'swing', x: 100, y: 260, length: 90, orientation: 'v', swing: 1, hinge: 1 }],
}

describe('handoff pack/unpack', () => {
  it('round-trips a payload', () => {
    const payload: HandoffPayload = { v: 1, source: 'moveday', name: 'Maple St 2BR', listingId: 'l1', plan }
    const back = unpackHandoff(packHandoff(payload))
    expect(back).toEqual(payload)
  })

  it('rejects tampered / non-payload strings', () => {
    expect(unpackHandoff('not-a-real-payload')).toBeNull()
    expect(unpackHandoff('')).toBeNull()
  })

  it('rejects wrong version or source', () => {
    const bad1 = packHandoff({ v: 2, source: 'moveday', name: 'x', plan } as unknown as HandoffPayload)
    const bad2 = packHandoff({ v: 1, source: 'elsewhere', name: 'x', plan } as unknown as HandoffPayload)
    expect(unpackHandoff(bad1)).toBeNull()
    expect(unpackHandoff(bad2)).toBeNull()
  })

  it('a rooms-only plan packs far under the URL budget', () => {
    const packed = packHandoff({ v: 1, source: 'moveday', name: 'Test', plan })
    expect(packed.length).toBeLessThan(MAX_PACKED_LENGTH / 10)
  })
})

describe('composeFitCheckPlan', () => {
  const sofa = { id: 'f1', name: 'Sofa', type: 'sofa', w: 220, h: 95, color: '#3d6b9e' }
  const bed = { id: 'f2', name: 'Bed', type: 'bed', w: 160, h: 200, color: '#c9a87c' }

  it('stages furniture in a row below the plan bounding box', () => {
    const composed = composeFitCheckPlan(plan, [sofa, bed], 'Maple St')
    const furniture = composed.furniture as Array<{ x: number; y: number; w: number; h: number }>
    expect(furniture).toHaveLength(2)
    // Every staged piece sits below the original plan
    for (const f of furniture) expect(f.y).toBeGreaterThanOrEqual(900)
    // No overlap in the staging row
    expect(furniture[1].x).toBeGreaterThanOrEqual(furniture[0].x + furniture[0].w)
    // Canvas grew to hold the row
    expect(composed.height as number).toBeGreaterThan(900)
  })

  it('keeps existing plan furniture and leaves the plan otherwise intact', () => {
    const withFurn = { ...plan, furniture: [{ id: 'existing', name: 'Counter', x: 1, y: 1, w: 10, h: 10, rotation: 0, color: '#fff' }] }
    const composed = composeFitCheckPlan(withFurn, [sofa], 'X')
    const ids = (composed.furniture as Array<{ id: string }>).map((f) => f.id)
    expect(ids).toContain('existing')
    expect(composed.rooms).toEqual(plan.rooms)
  })

  it('adds no staging row for an empty furniture list', () => {
    const composed = composeFitCheckPlan(plan, [], 'X')
    expect(composed.height).toBe(900)
    expect(composed.furniture).toEqual([])
  })
})

describe('furnisherImportUrl', () => {
  it('builds a fragment URL against the Furnisher origin', () => {
    const url = furnisherImportUrl({ v: 1, source: 'moveday', name: 'Test', plan })
    expect(url).toMatch(/^https:\/\/furnisher\.vercel\.app\/#import=/)
  })
})
