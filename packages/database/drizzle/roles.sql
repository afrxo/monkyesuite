-- monkyesuite — database roles & grants (specs/06-identity-access.md)
--
-- Two runtime roles share one database:
--   monkye_app     — restricted role, RLS ENFORCED. Used by apps/api. Sets
--                    app.current_user_id per request transaction so the
--                    scoped policies in schema.ts resolve. NOBYPASSRLS.
--   monkye_service — service role, RLS BYPASSED. Used by apps/worker (pgx).
--                    Writes only GLOBAL scraped tables; must never be filtered.
--
-- Neither role owns the tables (the migration/admin role does), so RLS applies
-- to monkye_app. monkye_service carries BYPASSRLS instead of table ownership.
--
-- Run this AFTER `pnpm db:migrate` (grants reference existing tables), and
-- re-run after any migration that adds tables. Role creation is idempotent.
-- BYPASSRLS requires a superuser to set (note for Railway provisioning).

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select from pg_roles where rolname = 'monkye_app') then
    create role monkye_app login password 'app_pw';
  end if;
end $$;

do $$ begin
  if not exists (select from pg_roles where rolname = 'monkye_service') then
    create role monkye_service login password 'service_pw';
  end if;
end $$;

alter role monkye_app nobypassrls;
alter role monkye_service bypassrls;

grant usage on schema public to monkye_app, monkye_service;

-- ---------------------------------------------------------------------------
-- GLOBAL realm — scraped, shared, no access control. Granted to BOTH roles.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on
  games,
  game_metrics,
  game_stats,
  lifecycle_events,
  sort_snapshots,
  game_events,
  creators,
  game_passes,
  dev_products,
  creator_portfolio,
  tags,
  game_tags,
  demand_terms,
  demand_snapshots,
  enrich_jobs
to monkye_app, monkye_service;

-- ---------------------------------------------------------------------------
-- PROJECT-SCOPED realm + user-authored content + identity.
-- Granted to the APP role ONLY. RLS is the backstop; the service role has no
-- grant here at all (defence in depth on top of its BYPASSRLS attribute).
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on
  projects,
  memberships,
  invites,
  milestones,
  tasks,
  docs,
  notes,
  project_game,
  game_notes,
  users,
  sessions,
  accounts,
  verifications
to monkye_app;

-- Sequences (uuid/serial defaults): app role needs usage across the schema.
grant usage, select on all sequences in schema public to monkye_app;

-- RLS membership predicates (SECURITY DEFINER, created in migration 0001).
-- Only the app role calls them, when scoped policies evaluate. PUBLIC EXECUTE
-- was revoked in the migration; the service role never needs them (it bypasses
-- RLS and has no scoped grants). Guarded so roles.sql is safe pre-0001.
do $$ begin
  if exists (select from pg_proc where proname = 'is_project_member') then
    grant execute on function is_project_member(uuid) to monkye_app;
    grant execute on function is_project_owner(uuid) to monkye_app;
  end if;
  -- Item→project resolvers + privileged invite-accept (created in functions.sql).
  if exists (select from pg_proc where proname = 'project_exists') then
    grant execute on function project_exists(uuid) to monkye_app;
    grant execute on function project_of_invite(uuid) to monkye_app;
    grant execute on function accept_invite(text, text) to monkye_app;
    grant execute on function create_project(text, text, text, text) to monkye_app;
    grant execute on function remove_member(uuid, text) to monkye_app;
  end if;
end $$;
