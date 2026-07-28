-- ═══════════════════════════════════════════════════════════════════════════
-- MoveDay cloud sync — one hunt row per user on the shared "Central DB" project
-- Dashboard ref must show:  tmycdgnofvmbyrmpqohw   (shared with MapCrowd/Tracker/Furnisher)
--
-- Idempotent: safe to re-run.
--
-- Design note: FABLE_BRIEF.md §6 floated a dedicated `moveday` Postgres schema.
-- MoveDay is a client-only static-export app that talks to PostgREST with the
-- ANON key (like Tracker/MapCrowd/Furnisher — see unified-backend/CONVENTIONS.md
-- "Pattern A"), not via a server-side ORM the way PersonalAssist does. A custom
-- schema would have to be exposed project-wide in the shared project's API
-- settings; a prefixed table in `public` gives the same isolation (own-row RLS +
-- the `moveday_` namespace) with zero shared-config change. Switchable later if
-- desired.
--
-- Rollback:  drop table if exists public.moveday_hunts;
-- ═══════════════════════════════════════════════════════════════════════════

-- Wrong-project guard: Central DB has Tracker's `trackers` + MapCrowd's `pins`.
do $$
begin
  if to_regclass('public.trackers') is null or to_regclass('public.pins') is null then
    raise exception 'WRONG PROJECT — run on Central DB (ref tmycdgnofvmbyrmpqohw); trackers/pins are missing here.';
  end if;
end $$;

-- One row per user: the entire hunt (listings, anchors, furniture, tour notes)
-- is a single JSON document, mirroring the app's localStorage model. Photos are
-- NOT synced (they live in the browser's IndexedDB) — a synced hunt's photoIds
-- only resolve on the device that holds the blobs. That's a known v1 limitation.
create table if not exists public.moveday_hunts (
  user_id    uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.moveday_hunts enable row level security;

drop policy if exists "own hunt: read"   on public.moveday_hunts;
drop policy if exists "own hunt: insert" on public.moveday_hunts;
drop policy if exists "own hunt: update" on public.moveday_hunts;
create policy "own hunt: read"   on public.moveday_hunts for select using (auth.uid() = user_id);
create policy "own hunt: insert" on public.moveday_hunts for insert with check (auth.uid() = user_id);
create policy "own hunt: update" on public.moveday_hunts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
