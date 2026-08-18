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

-- Scoped board/workspace item → owning project. Same 404-vs-403 role as the
-- other resolvers below: resolve the target row's project WITHOUT leaking content,
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

create or replace function project_of_project_tag(p uuid) returns uuid
  language sql stable security definer set search_path = public as $$
    select project_id from project_tags where id = p;
  $$;

create or replace function project_of_doc_folder(p uuid) returns uuid
  language sql stable security definer set search_path = public as $$
    select project_id from doc_folders where id = p;
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
-- Adding a collaborator (specs/06 §6.3, specs/09 §9.3a).
--
-- The closed suite has no invite/token/expiry flow: every user already has an
-- account (admin-created, specs/06 §6.1), so adding a collaborator is a direct,
-- synchronous membership write against an EXISTING user looked up by email.
-- Two entry points share the same shape and the same cap arithmetic:
--   add_member_by_email — the owner-gated route (POST /projects/:id/members).
--     The API's resolveProjectAccess(requireOwner) is the primary gate; this
--     function performs the privileged insert (memberships has no insert
--     policy at all — chicken/egg, same reason remove_member exists above).
--   admin_add_member    — the admin-panel equivalent. An admin is GLOBAL and
--     confers no project membership, so it cannot go through the owner path;
--     this is the same insert, gated by requireAdmin at the API instead of
--     ownership, with its own no_project code since a plain owner-gated call
--     never needs to say "no such project" (the owner check already implies it
--     exists) but an admin call can name any project id.
-- Both enforce the two-collaborator cap INSIDE the function, not the caller,
-- so neither path can be routed around the rule the other obeys.
--
-- Return codes: ok | no_project (admin only) | no_user | already_member | cap.
-- ---------------------------------------------------------------------------

create or replace function add_member_by_email(
    p_project uuid, p_email text, p_role text
  ) returns table (code text, membership_id uuid)
  language plpgsql security definer set search_path = public as $$
  declare
    target_user text;
    member_count int;
    existing_id uuid;
    new_id uuid;
  begin
    select id into target_user from users where email = p_email;
    if not found then
      return query select 'no_user'::text, null::uuid;
      return;
    end if;

    select id into existing_id from memberships
      where project_id = p_project and user_id = target_user;
    if found then
      return query select 'already_member'::text, existing_id;
      return;
    end if;

    select count(*) into member_count from memberships
      where project_id = p_project and role = 'member';
    if p_role = 'member' and member_count >= 2 then
      return query select 'cap'::text, null::uuid;
      return;
    end if;

    insert into memberships (project_id, user_id, role)
      values (p_project, target_user, p_role::member_role)
      returning id into new_id;

    return query select 'ok'::text, new_id;
  end;
  $$;

create or replace function admin_add_member(
    p_project uuid, p_email text, p_role text, p_added_by text
  ) returns table (code text, membership_id uuid)
  language plpgsql security definer set search_path = public as $$
  declare
    r record;
  begin
    if not exists (select 1 from projects where id = p_project) then
      return query select 'no_project'::text, null::uuid;
      return;
    end if;
    select * into r from add_member_by_email(p_project, p_email, p_role);
    return query select r.code, r.membership_id;
  end;
  $$;

-- Not world-executable. roles.sql grants EXECUTE to the app role only; the
-- service role bypasses RLS and never needs these.
revoke all on function is_project_member(uuid) from public;
revoke all on function is_project_owner(uuid) from public;
revoke all on function project_exists(uuid) from public;
revoke all on function project_of_task(uuid) from public;
revoke all on function project_of_milestone(uuid) from public;
revoke all on function project_of_doc(uuid) from public;
revoke all on function project_of_note(uuid) from public;
revoke all on function project_of_project_tag(uuid) from public;
revoke all on function project_of_doc_folder(uuid) from public;
revoke all on function add_member_by_email(uuid, text, text) from public;
revoke all on function admin_add_member(uuid, text, text, text) from public;
