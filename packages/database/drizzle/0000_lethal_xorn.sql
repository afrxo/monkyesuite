CREATE TYPE "public"."demand_kind" AS ENUM('game', 'theme');--> statement-breakpoint
CREATE TYPE "public"."invite_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_event_type" AS ENUM('launch', 'spike', 'cooldown', 'decline', 'revival', 'death', 'sort_appearance', 'sort_exit', 'update_shipped');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_stage" AS ENUM('launching', 'growing', 'stable', 'cooling', 'declining', 'dormant', 'revived');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('planned', 'active', 'done');--> statement-breakpoint
CREATE TYPE "public"."note_visibility" AS ENUM('shared', 'private');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'paused', 'shipped', 'archived');--> statement-breakpoint
CREATE TYPE "public"."tag_axis" AS ENUM('genre', 'mechanic', 'progression', 'social', 'monetization');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('none', 'low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('backlog', 'todo', 'in_progress', 'review', 'done', 'archived');--> statement-breakpoint
CREATE TABLE "creator_portfolio" (
	"creator_id" bigint NOT NULL,
	"universe_id" bigint NOT NULL,
	"name" text,
	"visits" bigint,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_portfolio_creator_id_universe_id_pk" PRIMARY KEY("creator_id","universe_id")
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"creator_id" bigint PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text,
	"has_verified_badge" boolean,
	"member_count" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demand_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_id" uuid NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"yt_video_count_7d" integer,
	"yt_view_delta_7d" bigint,
	"trends_score" double precision
);
--> statement-breakpoint
CREATE TABLE "demand_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term" text NOT NULL,
	"kind" "demand_kind" NOT NULL,
	"universe_id" bigint,
	"genre_label" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dev_products" (
	"product_id" bigint PRIMARY KEY NOT NULL,
	"universe_id" bigint NOT NULL,
	"name" text,
	"price_robux" integer,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "game_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"universe_id" bigint NOT NULL,
	"title" text,
	"subtitle" text,
	"tagline" text,
	"start_utc" timestamp with time zone,
	"end_utc" timestamp with time zone,
	"host_id" bigint,
	"host_name" text,
	"categories" jsonb,
	"thumbnail_url" text,
	"status" text,
	"created_utc" timestamp with time zone,
	"updated_utc" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "game_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" bigint NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"playing" integer,
	"visits" bigint,
	"favorited_count" bigint,
	"up_votes" bigint,
	"down_votes" bigint,
	"has_verified_badge" boolean,
	"active_event" boolean DEFAULT false,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "game_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" bigint NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"visibility" "note_visibility" DEFAULT 'shared' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "game_passes" (
	"pass_id" bigint PRIMARY KEY NOT NULL,
	"universe_id" bigint NOT NULL,
	"name" text,
	"price_robux" integer,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" bigint NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"trend_score" double precision,
	"velocity" double precision,
	"spike_score" double precision,
	"lifecycle" "lifecycle_stage",
	"ccu_slope_7d" double precision,
	"ccu_slope_28d" double precision,
	"ccu_mean_24h" double precision,
	"trough_peak_ratio" double precision,
	"like_ratio" double precision,
	"favorites_per_visit" double precision,
	"days_since_update" integer,
	"updates_per_28d" integer,
	"genre_percentile" double precision
);
--> statement-breakpoint
CREATE TABLE "game_tags" (
	"universe_id" bigint NOT NULL,
	"tag_id" uuid NOT NULL,
	"added_by" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_tags_universe_id_tag_id_pk" PRIMARY KEY("universe_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"universe_id" bigint PRIMARY KEY NOT NULL,
	"root_place_id" bigint,
	"name" text NOT NULL,
	"description" text,
	"creator_type" text,
	"creator_id" bigint,
	"creator_name" text,
	"roblox_genre" text,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_tracked" boolean DEFAULT true NOT NULL,
	"source" text,
	"current_sort" text,
	"current_sort_rank" integer,
	"last_sort_seen" timestamp with time zone,
	"icon_url" text,
	"max_players" integer,
	"playable_devices" jsonb,
	"supported_languages" jsonb,
	"age_recommendation" text,
	"descriptors" jsonb
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"token" text NOT NULL,
	"status" "invite_status" DEFAULT 'pending' NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" bigint NOT NULL,
	"type" "lifecycle_event_type" NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"magnitude" double precision,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "milestone_status" DEFAULT 'planned' NOT NULL,
	"order_key" text NOT NULL,
	"target_date" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "milestones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text,
	"body" text,
	"universe_id" bigint,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_game" (
	"project_id" uuid NOT NULL,
	"universe_id" bigint NOT NULL,
	"note" text,
	"added_by" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_game_project_id_universe_id_pk" PRIMARY KEY("project_id","universe_id")
);
--> statement-breakpoint
ALTER TABLE "project_game" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sort_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"universe_id" bigint NOT NULL,
	"sort_name" text NOT NULL,
	"rank" integer NOT NULL,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"axis" "tag_axis" NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"milestone_id" uuid,
	"parent_task_id" uuid,
	"title" text NOT NULL,
	"body" text,
	"status" "task_status" DEFAULT 'backlog' NOT NULL,
	"priority" "task_priority" DEFAULT 'none' NOT NULL,
	"order_key" text NOT NULL,
	"assignee_id" text,
	"universe_id" bigint,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "creator_portfolio" ADD CONSTRAINT "creator_portfolio_creator_id_creators_creator_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("creator_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_snapshots" ADD CONSTRAINT "demand_snapshots_term_id_demand_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."demand_terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_terms" ADD CONSTRAINT "demand_terms_universe_id_games_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."games"("universe_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_products" ADD CONSTRAINT "dev_products_universe_id_games_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."games"("universe_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_universe_id_games_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."games"("universe_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_metrics" ADD CONSTRAINT "game_metrics_universe_id_games_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."games"("universe_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_notes" ADD CONSTRAINT "game_notes_universe_id_games_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."games"("universe_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_notes" ADD CONSTRAINT "game_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_passes" ADD CONSTRAINT "game_passes_universe_id_games_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."games"("universe_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_stats" ADD CONSTRAINT "game_stats_universe_id_games_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."games"("universe_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_tags" ADD CONSTRAINT "game_tags_universe_id_games_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."games"("universe_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_tags" ADD CONSTRAINT "game_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_universe_id_games_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."games"("universe_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_universe_id_games_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."games"("universe_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_game" ADD CONSTRAINT "project_game_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_game" ADD CONSTRAINT "project_game_universe_id_games_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."games"("universe_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_game" ADD CONSTRAINT "project_game_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sort_snapshots" ADD CONSTRAINT "sort_snapshots_universe_id_games_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."games"("universe_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_universe_id_games_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."games"("universe_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "demand_snapshots_term_captured_uq" ON "demand_snapshots" USING btree ("term_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "demand_terms_term_kind_uq" ON "demand_terms" USING btree ("term","kind");--> statement-breakpoint
CREATE INDEX "dev_products_universe_idx" ON "dev_products" USING btree ("universe_id");--> statement-breakpoint
CREATE INDEX "docs_project_idx" ON "docs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "game_events_universe_idx" ON "game_events" USING btree ("universe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_metrics_universe_captured_uq" ON "game_metrics" USING btree ("universe_id","captured_at");--> statement-breakpoint
CREATE INDEX "game_metrics_captured_idx" ON "game_metrics" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "game_notes_universe_idx" ON "game_notes" USING btree ("universe_id","created_at");--> statement-breakpoint
CREATE INDEX "game_notes_author_idx" ON "game_notes" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "game_passes_universe_idx" ON "game_passes" USING btree ("universe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_stats_universe_computed_uq" ON "game_stats" USING btree ("universe_id","computed_at");--> statement-breakpoint
CREATE INDEX "game_stats_lifecycle_idx" ON "game_stats" USING btree ("lifecycle");--> statement-breakpoint
CREATE INDEX "game_stats_trend_idx" ON "game_stats" USING btree ("trend_score");--> statement-breakpoint
CREATE INDEX "game_tags_tag_idx" ON "game_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "games_updated_idx" ON "games" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "games_genre_idx" ON "games" USING btree ("roblox_genre");--> statement-breakpoint
CREATE INDEX "games_tracked_idx" ON "games" USING btree ("is_tracked");--> statement-breakpoint
CREATE INDEX "games_sort_idx" ON "games" USING btree ("current_sort","current_sort_rank");--> statement-breakpoint
CREATE INDEX "games_creator_idx" ON "games" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_token_uq" ON "invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX "invites_project_idx" ON "invites" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "invites_email_idx" ON "invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "lifecycle_events_universe_idx" ON "lifecycle_events" USING btree ("universe_id");--> statement-breakpoint
CREATE INDEX "lifecycle_events_detected_idx" ON "lifecycle_events" USING btree ("detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_project_user_uq" ON "memberships" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "milestones_project_idx" ON "milestones" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "notes_project_idx" ON "notes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "notes_universe_idx" ON "notes" USING btree ("universe_id");--> statement-breakpoint
CREATE INDEX "project_game_universe_idx" ON "project_game" USING btree ("universe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_slug_uq" ON "projects" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "sort_snapshots_uq" ON "sort_snapshots" USING btree ("universe_id","sort_name","captured_at");--> statement-breakpoint
CREATE INDEX "sort_snapshots_captured_idx" ON "sort_snapshots" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "sort_snapshots_sort_idx" ON "sort_snapshots" USING btree ("sort_name","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_axis_slug_uq" ON "tags" USING btree ("axis","slug");--> statement-breakpoint
CREATE INDEX "tasks_project_idx" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tasks_board_idx" ON "tasks" USING btree ("project_id","status","order_key");--> statement-breakpoint
CREATE INDEX "tasks_milestone_idx" ON "tasks" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX "tasks_universe_idx" ON "tasks" USING btree ("universe_id");--> statement-breakpoint
CREATE POLICY "docs_member_rw" ON "docs" AS PERMISSIVE FOR ALL TO public USING (exists (select 1 from memberships m where m.project_id = "docs"."project_id" and m.user_id = current_setting('app.current_user_id', true))) WITH CHECK (exists (select 1 from memberships m where m.project_id = "docs"."project_id" and m.user_id = current_setting('app.current_user_id', true)));--> statement-breakpoint
CREATE POLICY "game_notes_select" ON "game_notes" AS PERMISSIVE FOR SELECT TO public USING (visibility = 'shared' or author_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "game_notes_write" ON "game_notes" AS PERMISSIVE FOR ALL TO public USING (author_id = current_setting('app.current_user_id', true)) WITH CHECK (author_id = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "invites_member_rw" ON "invites" AS PERMISSIVE FOR ALL TO public USING (exists (select 1 from memberships m where m.project_id = "invites"."project_id" and m.user_id = current_setting('app.current_user_id', true)));--> statement-breakpoint
CREATE POLICY "memberships_select" ON "memberships" AS PERMISSIVE FOR SELECT TO public USING (exists (select 1 from memberships m2 where m2.project_id = "memberships"."project_id" and m2.user_id = current_setting('app.current_user_id', true)));--> statement-breakpoint
CREATE POLICY "milestones_member_rw" ON "milestones" AS PERMISSIVE FOR ALL TO public USING (exists (select 1 from memberships m where m.project_id = "milestones"."project_id" and m.user_id = current_setting('app.current_user_id', true))) WITH CHECK (exists (select 1 from memberships m where m.project_id = "milestones"."project_id" and m.user_id = current_setting('app.current_user_id', true)));--> statement-breakpoint
CREATE POLICY "notes_member_rw" ON "notes" AS PERMISSIVE FOR ALL TO public USING (exists (select 1 from memberships m where m.project_id = "notes"."project_id" and m.user_id = current_setting('app.current_user_id', true))) WITH CHECK (exists (select 1 from memberships m where m.project_id = "notes"."project_id" and m.user_id = current_setting('app.current_user_id', true)));--> statement-breakpoint
CREATE POLICY "project_game_member_rw" ON "project_game" AS PERMISSIVE FOR ALL TO public USING (exists (select 1 from memberships m where m.project_id = "project_game"."project_id" and m.user_id = current_setting('app.current_user_id', true))) WITH CHECK (exists (select 1 from memberships m where m.project_id = "project_game"."project_id" and m.user_id = current_setting('app.current_user_id', true)));--> statement-breakpoint
CREATE POLICY "projects_select" ON "projects" AS PERMISSIVE FOR SELECT TO public USING (exists (select 1 from memberships m where m.project_id = "projects"."id" and m.user_id = current_setting('app.current_user_id', true)));--> statement-breakpoint
CREATE POLICY "projects_insert" ON "projects" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('app.current_user_id', true) is not null);--> statement-breakpoint
CREATE POLICY "projects_update" ON "projects" AS PERMISSIVE FOR UPDATE TO public USING (exists (select 1 from memberships m where m.project_id = "projects"."id" and m.user_id = current_setting('app.current_user_id', true) and m.role = 'owner'));--> statement-breakpoint
CREATE POLICY "projects_delete" ON "projects" AS PERMISSIVE FOR DELETE TO public USING (exists (select 1 from memberships m where m.project_id = "projects"."id" and m.user_id = current_setting('app.current_user_id', true) and m.role = 'owner'));--> statement-breakpoint
CREATE POLICY "tasks_member_rw" ON "tasks" AS PERMISSIVE FOR ALL TO public USING (exists (select 1 from memberships m where m.project_id = "tasks"."project_id" and m.user_id = current_setting('app.current_user_id', true))) WITH CHECK (exists (select 1 from memberships m where m.project_id = "tasks"."project_id" and m.user_id = current_setting('app.current_user_id', true)));