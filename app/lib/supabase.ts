import { createClient } from '@supabase/supabase-js'

// Optional cloud backend (adapted from Furnisher's lib/supabase.ts). If the env
// vars aren't set, MoveDay runs fully local — the "Sign in to sync" button just
// stays hidden and nothing else changes. Local-first stays the default.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabaseEnabled = !!(url && anon)

export const supabase = supabaseEnabled
  ? createClient(url as string, anon as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null
