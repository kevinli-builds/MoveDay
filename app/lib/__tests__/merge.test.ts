import { describe, expect, it } from 'vitest'
import { mergeSharedListings } from '../merge'
import type { Listing } from '../types'

// The shared-hunt merge is the anti-clobber seam for partner sharing. These lock
// the add-wins / my-edits-win / my-deletes-honored rules.

function l(id: string, name = id): Listing {
  return { id, createdAt: '2026-01-01', status: 'saved', name, photoIds: [], commutes: [] }
}

describe('mergeSharedListings', () => {
  it('keeps a listing the partner added (not in mine, not previously synced)', () => {
    const merged = mergeSharedListings([l('a')], [l('a'), l('b')], ['a'])
    expect(merged.map((x) => x.id).sort()).toEqual(['a', 'b'])
  })

  it('keeps a listing I added (only in mine)', () => {
    const merged = mergeSharedListings([l('a'), l('mine')], [l('a')], ['a'])
    expect(merged.map((x) => x.id).sort()).toEqual(['a', 'mine'])
  })

  it('my version wins for a listing we both have', () => {
    const merged = mergeSharedListings([l('a', 'my name')], [l('a', 'their name')], ['a'])
    expect(merged.find((x) => x.id === 'a')?.name).toBe('my name')
  })

  it('honors a delete: a previously-synced listing gone from mine stays gone', () => {
    // 'b' was synced before (in knownIds) but I removed it; partner still has it.
    const merged = mergeSharedListings([l('a')], [l('a'), l('b')], ['a', 'b'])
    expect(merged.map((x) => x.id)).toEqual(['a'])
  })

  it('resurrects a partner-deleted listing I still hold (documented limitation)', () => {
    // 'a' only in mine; remote dropped it. Union keeps mine.
    const merged = mergeSharedListings([l('a')], [], ['a'])
    expect(merged.map((x) => x.id)).toEqual(['a'])
  })
})
