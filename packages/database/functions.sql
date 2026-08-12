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

-- Not world-executable. roles.sql grants EXECUTE to the app role only; the
-- service role bypasses RLS and never needs these.
revoke all on function is_project_member(uuid) from public;
revoke all on function is_project_owner(uuid) from public;
