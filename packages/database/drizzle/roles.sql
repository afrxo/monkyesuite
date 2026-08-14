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
-- OPERATIONS realm — worker telemetry + the admin control plane (specs/09 §9.6).
-- GLOBAL tables, so both roles: the worker WRITES job_runs and marks job_commands
-- as it drains them; the API READS both and inserts commands from /admin.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on
  job_runs,
  job_commands
to monkye_app, monkye_service;

-- audit_log is APPEND-ONLY, and that is a GRANT, not a convention: no update,
-- no delete, to anyone. App role only — the worker has no actor to attribute a
-- row to and never writes one.
grant select, insert on audit_log to monkye_app;

-- ---------------------------------------------------------------------------
-- PROJECT-SCOPED realm + user-authored content + identity.
-- Granted to the APP role ONLY. RLS is the backstop; the service role has no
-- grant here at all (defence in depth on top of its BYPASSRLS attribute).
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on
  projects,
  memberships,
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
  -- Item→project resolvers (created in functions.sql).
  if exists (select from pg_proc where proname = 'project_exists') then
    grant execute on function project_exists(uuid) to monkye_app;
    grant execute on function project_of_task(uuid) to monkye_app;
    grant execute on function project_of_milestone(uuid) to monkye_app;
    grant execute on function project_of_doc(uuid) to monkye_app;
    grant execute on function project_of_note(uuid) to monkye_app;
    grant execute on function create_project(text, text, text, text) to monkye_app;
    grant execute on function remove_member(uuid, text) to monkye_app;
  end if;
  -- Adding a collaborator, owner and admin paths (specs/06 §6.3, specs/09
  -- §9.3a). Privileged insert with the collaborator cap enforced inside the
  -- function, so neither path ever needs a policy weakened.
  if exists (select from pg_proc where proname = 'add_member_by_email') then
    grant execute on function add_member_by_email(uuid, text, text) to monkye_app;
    grant execute on function admin_add_member(uuid, text, text, text) to monkye_app;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- pg_monitor for the app role — the admin derive-health panel (specs/09 §9.4.4)
-- reads live Postgres load from pg_stat_activity. Derive runs as monkye_service
-- while the API connects as monkye_app, and without pg_monitor a non-superuser
-- sees other roles' backends with state/query/wait columns NULL'd — i.e. the
-- panel would read empty and look like "no load" rather than "not permitted".
--
-- Scope note: pg_monitor also confers pg_read_all_settings. That is acceptable
-- here because the panel renders COUNTS AND AGES ONLY — never query text, never
-- a setting value (§9.3b's hard rule). Granting the role is what keeps the
-- panel honest; the panel is what keeps the grant harmless.
--
-- Granting a predefined role requires superuser (same as BYPASSRLS above), so
-- it is guarded: on an instance provisioned by a non-superuser this warns and
-- the panel degrades to job_runs.duration_ms with an explicit "live read
-- unavailable" banner rather than a silently empty panel.
do $$ begin
  grant pg_monitor to monkye_app;
exception when insufficient_privilege then
  raise warning 'could not grant pg_monitor to monkye_app (needs superuser); admin derive-health panel will degrade to job_runs only';
end $$;
