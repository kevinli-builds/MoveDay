-- ═══════════════════════════════════════════════════════════════════════════
-- MoveDay partner sharing — two people collaborate on one hunt.
-- Dashboard ref must show:  tmycdgnofvmbyrmpqohw   ("Central DB")
--
-- Builds on 01-moveday-hunts.sql. A hunt stays one-row-per-owner (keyed by
-- moveday_hunts.user_id); this migration adds a share token, a members table,
-- and owner-OR-member RLS + join/revoke functions — Furnisher's projects model,
-- ported. Idempotent; safe to re-run.
--
-- Rollback:
--   drop trigger if exists guard_moveday_owner_cols on public.moveday_hunts;
--   drop function if exists public.guard_moveday_owner_cols(),
--     public.is_moveday_member(uuid), public.join_moveday_hunt(uuid),
--     public.revoke_moveday_sharing();
--   drop table if exists public.moveday_hunt_members;
--   alter table public.moveday_hunts drop column if exists share_token;
-- ═══════════════════════════════════════════════════════════════════════════

-- Wrong-project guard.
do $$
begin
  if to_regclass('public.trackers') is null or to_regclass('public.pins') is null then
    raise exception 'WRONG PROJECT — run on Central DB (ref tmycdgnofvmbyrmpqohw); trackers/pins are missing here.';
  end if;
end $$;

-- Share token on each hunt (the hunt is identified by its owner's user_id).
alter table public.moveday_hunts add column if not exists share_token uuid unique;

-- Who besides the owner can access a hunt.
create table if not exists public.moveday_hunt_members (
  hunt_owner uuid not null references auth.users (id) on delete cascade,
  member_id  uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (hunt_owner, member_id)
);
alter table public.moveday_hunt_members enable row level security;

-- A member sees their own membership; the owner sees all of their hunt's.
-- No client insert/delete policy — membership changes go only through the
-- SECURITY DEFINER functions below, so a client can't forge a membership.
drop policy if exists "see relevant memberships" on public.moveday_hunt_members;
create policy "see relevant memberships" on public.moveday_hunt_members for select
  using (member_id = auth.uid() or hunt_owner = auth.uid());

-- Membership check (security definer avoids RLS recursion on moveday_hunts).
create or replace function public.is_moveday_member(p_owner uuid)
  returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.moveday_hunt_members
    where hunt_owner = p_owner and member_id = auth.uid()
  );
$$;

-- Members can read + edit the shared hunt (these OR with the owner policies
-- from migration 01).
drop policy if exists "members read hunt"   on public.moveday_hunts;
drop policy if exists "members update hunt" on public.moveday_hunts;
create policy "members read hunt"   on public.moveday_hunts for select using (public.is_moveday_member(user_id));
create policy "members update hunt" on public.moveday_hunts for update using (public.is_moveday_member(user_id)) with check (public.is_moveday_member(user_id));

-- Redeem a share token → become a member; returns the hunt's owner id (its key).
create or replace function public.join_moveday_hunt(p_token uuid)
  returns uuid language plpgsql security definer set search_path = public as $$
declare owner_id uuid;
begin
  select user_id into owner_id from public.moveday_hunts where share_token = p_token;
  if owner_id is null then return null; end if;
  if owner_id = auth.uid() then return owner_id; end if; -- joining your own hunt is a no-op
  insert into public.moveday_hunt_members (hunt_owner, member_id)
    values (owner_id, auth.uid()) on conflict do nothing;
  return owner_id;
end; $$;
grant execute on function public.join_moveday_hunt(uuid) to authenticated;

-- Owner turns sharing off: clears the token AND removes everyone who joined, so
-- the link actually cuts off access (a bare token-null would leave members with
-- read+write forever).
create or replace function public.revoke_moveday_sharing()
  returns void language plpgsql security definer set search_path = public as $$
begin
  update public.moveday_hunts set share_token = null where user_id = auth.uid();
  delete from public.moveday_hunt_members where hunt_owner = auth.uid();
end; $$;
grant execute on function public.revoke_moveday_sharing() to authenticated;

-- A member leaves a hunt they joined (removes only their own membership).
create or replace function public.leave_moveday_hunt(p_owner uuid)
  returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.moveday_hunt_members where hunt_owner = p_owner and member_id = auth.uid();
end; $$;
grant execute on function public.leave_moveday_hunt(uuid) to authenticated;

-- Collaborators may edit the shared hunt's contents but must not seize ownership
-- or change its share token — lock those columns to the owner.
create or replace function public.guard_moveday_owner_cols()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() <> old.user_id
     and (new.user_id <> old.user_id or new.share_token is distinct from old.share_token) then
    raise exception 'Only the owner can change ownership or the share link';
  end if;
  return new;
end; $$;

drop trigger if exists guard_moveday_owner_cols on public.moveday_hunts;
create trigger guard_moveday_owner_cols before update on public.moveday_hunts
  for each row execute function public.guard_moveday_owner_cols();
