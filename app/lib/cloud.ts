import { supabase } from './supabase'
import { normalizeHunt } from './storage'
import { mergeSharedHunt } from './merge'
import type { Hunt } from './types'

// Cloud sync for hunts. A hunt is one row per owner (keyed by user_id) in
// moveday_hunts; partner sharing (migration 02) lets a member read+write the
// owner's row via RLS. Photos are NOT synced (IndexedDB, device-local).

const TABLE = 'moveday_hunts'
const MEMBERS = 'moveday_hunt_members'

function client() {
  if (!supabase) throw new Error('Cloud sync is not configured.')
  return supabase
}

async function myUserId(): Promise<string> {
  const { data } = await client().auth.getUser()
  const id = data.user?.id
  if (!id) throw new Error('Not signed in.')
  return id
}

export interface HuntSummary {
  ownerId: string // the hunt's key (owner's user_id)
  isOwner: boolean
  name: string
  updatedAt: string
  shared: boolean // owner: has a share token; member: always true (it's someone else's)
}

export interface CloudHunt {
  data: Hunt
  updatedAt: string
}

// Every hunt I can see: my own + ones I've joined. RLS does the filtering; the
// name is pulled out of the JSONB so we don't fetch full hunt bodies for a list.
export async function listHunts(): Promise<HuntSummary[]> {
  const me = await myUserId()
  const { data, error } = await client()
    .from(TABLE)
    .select('user_id, updated_at, share_token, name:data->>name')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r) => {
    const row = r as { user_id: string; updated_at: string; share_token: string | null; name: string | null }
    const isOwner = row.user_id === me
    return {
      ownerId: row.user_id,
      isOwner,
      name: row.name || 'My hunt',
      updatedAt: row.updated_at,
      shared: isOwner ? !!row.share_token : true,
    }
  })
}

// One hunt's full contents (own or joined). Cloud data is untrusted like an
// import → it passes back through normalizeHunt (the trust boundary).
export async function pullHunt(ownerId: string): Promise<CloudHunt | null> {
  const { data, error } = await client().from(TABLE).select('data, updated_at').eq('user_id', ownerId).maybeSingle()
  if (error) throw error
  if (!data) return null
  return { data: normalizeHunt(data.data), updatedAt: data.updated_at as string }
}

// Save MY own hunt. The row may not exist yet (first sync) → upsert.
export async function pushOwnHunt(hunt: Hunt): Promise<string> {
  const me = await myUserId()
  const updatedAt = new Date().toISOString()
  const { error } = await client()
    .from(TABLE)
    .upsert({ user_id: me, data: hunt, updated_at: updatedAt }, { onConflict: 'user_id' })
  if (error) throw error
  return updatedAt
}

// Save into a SHARED hunt (my shared one, or one I joined). Pull + merge first
// so a concurrent partner edit isn't clobbered; returns the merged data written
// so the caller can adopt it and keep local in step.
export async function pushHuntMerged(ownerId: string, mine: Hunt, knownIds: string[]): Promise<CloudHunt> {
  const remote = await pullHunt(ownerId)
  const merged = remote ? mergeSharedHunt(mine, remote.data, knownIds) : mine
  const updatedAt = new Date().toISOString()
  const { error } = await client().from(TABLE).update({ data: merged, updated_at: updatedAt }).eq('user_id', ownerId)
  if (error) throw error
  return { data: merged, updatedAt }
}

// ── Sharing (owner side) ──────────────────────────────────────────────────────
export async function getMyShareToken(): Promise<string | null> {
  const me = await myUserId()
  const { data, error } = await client().from(TABLE).select('share_token').eq('user_id', me).maybeSingle()
  if (error) throw error
  return (data?.share_token as string | null) ?? null
}

export async function enableSharing(): Promise<string> {
  const me = await myUserId()
  const token = crypto.randomUUID()
  const { error } = await client().from(TABLE).update({ share_token: token }).eq('user_id', me)
  if (error) throw error
  return token
}

// Clears the token AND removes all members (atomic, owner-checked in the RPC).
export async function disableSharing(): Promise<void> {
  const { error } = await client().rpc('revoke_moveday_sharing')
  if (error) throw error
}

export async function getMemberCount(): Promise<number> {
  const me = await myUserId()
  const { count, error } = await client().from(MEMBERS).select('*', { count: 'exact', head: true }).eq('hunt_owner', me)
  if (error) throw error
  return count ?? 0
}

// ── Sharing (member side) ─────────────────────────────────────────────────────
// Redeem a share token → become a member; returns the joined hunt's owner id.
export async function joinByToken(token: string): Promise<string | null> {
  const { data, error } = await client().rpc('join_moveday_hunt', { p_token: token })
  if (error) throw error
  return (data as string) ?? null
}

// Leave a hunt I joined (removes only my membership).
export async function leaveHunt(ownerId: string): Promise<void> {
  const { error } = await client().rpc('leave_moveday_hunt', { p_owner: ownerId })
  if (error) throw error
}
