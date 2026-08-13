-- Version-controlled RLS membership predicates.
--
-- Applied by `db:migrate` BEFORE the drizzle schema migrations (migration 0001
-- rewrites the scoped policies to CALL these functions). Kept OUT of the
-- generated migrations on purpose: drizzle-kit does not manage SQL functions,
-- so a future `db:generate` would never recreate a function block buried inside
-- a generated migration file — silently breaking RLS. Defining them here,
-- idempotently (CREATE OR REPLACE), makes regeneration safe: this file is the
-- single source for the functions and runs on every migrate.
--
-- SECURITY DEFINER runs the membership lookup as the function owner (the admin/
-- migration role, which is NOT subject to memberships' RLS). That is what breaks
-- the infinite recursion caused by inlining `exists (select … from memberships …)`
-- directly in a policy on a table that itself carries RLS.
--
-- current_setting('app.current_user_id', true) is NULL when unset, so a missing
-- session makes the predicate false → scoped reads still fail closed.
--
-- check_function_bodies=off lets these create even before `memberships` exists:
-- on a fresh database this file runs before the schema migrations, and the body
-- reference resolves at call time, after the table has been created.
set check_function_bodies = false;

create or replace function is_project_member(p uuid) returns boolean
  language sql stable security definer set search_path = public as $$
    select exists (
      select 1 from memberships m
      where m.project_id = p
        and m.user_id = current_setting('app.current_user_id', true)
    );
  $$;

create or replace function is_project_owner(p uuid) returns boolean
  language sql stable security definer set search_path = public as $$
    select exists (
      select 1 from memberships m
      where m.project_id = p
        and m.user_id = current_setting('app.current_user_id', true)
        and m.role = 'owner'
    );
  $$;

-- ---------------------------------------------------------------------------
-- Item → project resolution (RLS-bypassing minimal reads).
--
-- These power the 404-vs-403 rule for scoped ITEM routes (docs/api-contract.md):
-- resolve the target row's owning project (or its existence) BEFORE fetching the
-- row, then run the membership check. Because they are SECURITY DEFINER they see
-- the row regardless of the caller's membership, so the API can distinguish
-- "exists but you're not a member" (403) from "no such id" (404) without a
-- fetch-then-filter that RLS would collapse into an ambiguous empty result.
-- They take no user context and never leak row CONTENT — only project identity.
-- ---------------------------------------------------------------------------

create or replace function project_exists(p uuid) returns boolean
  language sql stable security definer set search_path = public as $$
    select exists (select 1 from projects where id = p);
  $$;

create or replace function project_of_invite(p uuid) returns uuid
  language sql stable security definer set search_path = public as $$
    select project_id from invites where id = p;
  $$;

-- Scoped board/workspace item → owning project. Same 404-vs-403 role as
-- project_of_invite: resolve the target row's project WITHOUT leaking content,
-- so the API can membership-check before it fetches (and RLS collapses a
-- non-member's read to empty). One per scoped item table with a flat item route.
create or replace function project_of_task(p uuid) returns uuid
  language sql stable security definer set search_path = public as $$
    select project_id from tasks where id = p;
  $$;

create or replace function project_of_milestone(p uuid) returns uuid
  language sql stable security definer set search_path = public as $$
    select project_id from milestones where id = p;
  $$;

create or replace function project_of_doc(p uuid) returns uuid
  language sql stable security definer set search_path = public as $$
    select project_id from docs where id = p;
  $$;

create or replace function project_of_note(p uuid) returns uuid
  language sql stable security definer set search_path = public as $$
    select project_id from notes where id = p;
  $$;

-- ---------------------------------------------------------------------------
-- accept_invite — the one privileged mutation an unauthenticated-for-this-project
-- user must perform: they are not yet a member, so RLS on invites/memberships
-- would hide everything. SECURITY DEFINER runs the whole accept atomically and
-- returns a status code the API maps to HTTP:
--   ok             -> 200 (+ membership id)
--   expired        -> 410 (invite marked expired; no membership created)
--   already_member -> 409
--   cap            -> 409 (two-collaborator cap reached)
--   not_found      -> 404 (no pending invite for this token)
-- Collaborator cap = at most two role='member' memberships per project.
-- ---------------------------------------------------------------------------
create or replace function accept_invite(p_token text, p_user_id text)
  returns table (code text, membership_id uuid)
  language plpgsql security definer set search_path = public as $$
  declare
    inv invites%rowtype;
    member_count int;
    new_id uuid;
  begin
    select * into inv from invites where token = p_token for update;

    if not found or inv.status <> 'pending' then
      return query select 'not_found'::text, null::uuid;
      return;
    end if;

    if inv.expires_at is not null and inv.expires_at < now() then
      update invites set status = 'expired' where id = inv.id;
      return query select 'expired'::text, null::uuid;
      return;
    end if;

    -- already a member of this project?
    select id into new_id from memberships
      where project_id = inv.project_id and user_id = p_user_id;
    if found then
      return query select 'already_member'::text, new_id;
      return;
    end if;

    -- collaborator cap: at most two role='member' memberships.
    select count(*) into member_count from memberships
      where project_id = inv.project_id and role = 'member';
    if inv.role = 'member' and member_count >= 2 then
      return query select 'cap'::text, null::uuid;
      return;
    end if;

    insert into memberships (project_id, user_id, role)
      values (inv.project_id, p_user_id, inv.role)
      returning id into new_id;
    update invites set status = 'accepted' where id = inv.id;

    return query select 'ok'::text, new_id;
  end;
  $$;

-- ---------------------------------------------------------------------------
-- Membership mutations. `memberships` intentionally has NO insert/delete RLS
-- policy (schema.ts): the very first owner row can't satisfy an ownerOf check
-- (no membership exists yet — chicken/egg), so membership writes go through
-- these SECURITY DEFINER functions instead of the app role's RLS path. The API
-- is the primary gate (requireOwner) before it ever calls remove_member.
-- ---------------------------------------------------------------------------

-- Create a project and its creator's owner membership atomically. Returns the
-- new project id. A duplicate slug raises unique_violation (23505) → API 409.
create or replace function create_project(
    p_name text, p_slug text, p_description text, p_user_id text
  ) returns uuid
  language plpgsql security definer set search_path = public as $$
  declare
    new_id uuid;
  begin
    insert into projects (name, slug, description, created_by)
      values (p_name, p_slug, p_description, p_user_id)
      returning id into new_id;
    insert into memberships (project_id, user_id, role)
      values (new_id, p_user_id, 'owner');
    return new_id;
  end;
  $$;

-- Remove a collaborator (role='member' only — an owner is never removed here).
-- Returns true if a row was deleted. Caller must already be the project owner
-- (API requireOwner); this only performs the privileged delete.
create or replace function remove_member(p_project uuid, p_user text)
  returns boolean
  language plpgsql security definer set search_path = public as $$
  declare
    deleted int;
  begin
    delete from memberships
      where project_id = p_project and user_id = p_user and role = 'member';
    get diagnostics deleted = row_count;
    return deleted > 0;
  end;
  $$;

-- ---------------------------------------------------------------------------
-- Admin-panel invite creation (specs/09 §9.3a).
--
-- The admin role is GLOBAL and deliberately confers no project membership, so
-- an admin inserting into `invites` resolves zero rows under the owner-gated
-- policy. The two obvious "fixes" are both wrong: weakening the invites policy
-- widens it for every caller, and fabricating a membership row for the admin
-- blurs the global/scoped realms. Instead the privileged insert lives here,
-- exactly like the other membership writes above — the policies stay untouched.
--
-- The collaborator cap is enforced INSIDE the function, not by the caller, so
-- the admin path cannot route around the rule the owner path obeys. The caller
-- (apps/api /admin) is the primary gate: requireAdmin runs before this is ever
-- called, and the token is generated caller-side to reuse the existing invite
-- flow verbatim.
create or replace function admin_create_invite(
    p_project uuid, p_email text, p_role text, p_invited_by text,
    p_token text, p_expires_at timestamptz
  ) returns table (code text, invite_id uuid)
  language plpgsql security definer set search_path = public as $$
  declare
    seats_used int;
    new_id uuid;
  begin
    if not exists (select 1 from projects where id = p_project) then
      return query select 'no_project'::text, null::uuid;
      return;
    end if;

    -- Same seat arithmetic as the owner-gated route: existing member
    -- collaborators plus still-pending invites must stay under the cap of two.
    select (select count(*) from memberships where project_id = p_project and role = 'member')
         + (select count(*) from invites where project_id = p_project and status = 'pending')
      into seats_used;
    if p_role = 'member' and seats_used >= 2 then
      return query select 'cap'::text, null::uuid;
      return;
    end if;

    insert into invites (project_id, email, role, token, invited_by, expires_at)
      values (p_project, p_email, p_role::member_role, p_token, p_invited_by, p_expires_at)
      returning id into new_id;

    return query select 'ok'::text, new_id;
  end;
  $$;

-- Not world-executable. roles.sql grants EXECUTE to the app role only; the
-- service role bypasses RLS and never needs these.
revoke all on function is_project_member(uuid) from public;
revoke all on function is_project_owner(uuid) from public;
revoke all on function project_exists(uuid) from public;
revoke all on function project_of_invite(uuid) from public;
revoke all on function project_of_task(uuid) from public;
revoke all on function project_of_milestone(uuid) from public;
revoke all on function project_of_doc(uuid) from public;
revoke all on function project_of_note(uuid) from public;
revoke all on function accept_invite(text, text) from public;
revoke all on function admin_create_invite(uuid, text, text, text, text, timestamptz) from public;
