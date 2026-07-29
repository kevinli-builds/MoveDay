import type { Hunt, Listing } from './types'

// Merge my copy of a shared hunt with the partner's, so two collaborators don't
// clobber each other's work. Rules for listings:
//   - a listing I have → my version wins (my edits/adds survive)
//   - a listing only the partner has, that I never synced → they added it → keep
//   - a listing only the partner has, that I HAD synced before → I deleted it → drop
// Non-listing fields (name/anchors/dealbreakers/furniture) are last-write-wins:
// they take my values.
//
// Known v1 limitation: without per-listing timestamps, a listing the PARTNER
// deleted while I still hold it will reappear on my next push — deletes only
// propagate from the device that made them. Acceptable for an async hunt board;
// real-time CRDT sync is a later increment.
export function mergeSharedListings(mine: Listing[], remote: Listing[], knownIds: string[]): Listing[] {
  const known = new Set(knownIds)
  const mineIds = new Set(mine.map((l) => l.id))
  const merged = [...mine]
  for (const r of remote) {
    if (mineIds.has(r.id)) continue // I have it → my version already included
    if (known.has(r.id)) continue // I deleted it → keep it deleted
    merged.push(r) // partner added it → keep
  }
  return merged
}

export function mergeSharedHunt(mine: Hunt, remote: Hunt, knownIds: string[]): Hunt {
  return { ...mine, listings: mergeSharedListings(mine.listings, remote.listings, knownIds) }
}
