import { supabase } from './supabase'
import { normalizeHunt } from './storage'
import type { Hunt } from './types'

// Cloud sync for the single per-user hunt document (table: moveday_hunts).
// Last-write-wins on one JSONB row; photos are NOT synced (IndexedDB, local).

const TABLE = 'moveday_hunts'

export interface CloudHunt {
  data: Hunt
  updatedAt: string
}

function client() {
  if (!supabase) throw new Error('Cloud sync is not configured.')
  return supabase
}

// The signed-in user's cloud hunt, or null if they've never synced. RLS scopes
// the select to their own row, so there is at most one. Cloud data is untrusted
// like any import — it passes back through normalizeHunt (the trust boundary).
export async function pullHunt(): Promise<CloudHunt | null> {
  const { data, error } = await client().from(TABLE).select('data, updated_at').maybeSingle()
  if (error) throw error
  if (!data) return null
  return { data: normalizeHunt(data.data), updatedAt: data.updated_at as string }
}

// Upsert the user's single hunt row. user_id is set explicitly (not left to the
// column default) so the insert path is unambiguous — Furnisher's convention.
export async function pushHunt(hunt: Hunt): Promise<string> {
  const { data: auth } = await client().auth.getUser()
  const userId = auth.user?.id
  if (!userId) throw new Error('Not signed in.')
  const updatedAt = new Date().toISOString()
  const { error } = await client()
    .from(TABLE)
    .upsert({ user_id: userId, data: hunt, updated_at: updatedAt }, { onConflict: 'user_id' })
  if (error) throw error
  return updatedAt
}
