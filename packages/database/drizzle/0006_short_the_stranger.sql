CREATE TYPE "public"."cohort_basis" AS ENUM('genre', 'global');--> statement-breakpoint
CREATE TYPE "public"."pulse_stage" AS ENUM('new', 'growing', 'peaking', 'declining');--> statement-breakpoint
CREATE TABLE "cohort_stats" (
	"universe_id" bigint PRIMARY KEY NOT NULL,
	"velocity_pct_in_cohort" double precision,
	"cohort_basis" "cohort_basis",
	"cohort_size" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_health" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"distribution_new" integer DEFAULT 0 NOT NULL,
	"distribution_growing" integer DEFAULT 0 NOT NULL,
	"distribution_peaking" integer DEFAULT 0 NOT NULL,
	"distribution_declining" integer DEFAULT 0 NOT NULL,
	"transitions_to_new_6h" integer DEFAULT 0 NOT NULL,
	"transitions_to_growing_6h" integer DEFAULT 0 NOT NULL,
	"transitions_to_peaking_6h" integer DEFAULT 0 NOT NULL,
	"transitions_to_declining_6h" integer DEFAULT 0 NOT NULL,
	"first_time_10k_today" integer DEFAULT 0 NOT NULL,
	"new_games_48h" integer DEFAULT 0 NOT NULL,
	"live_since" timestamp with time zone DEFAULT now() NOT NULL,
	"degraded_mode" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_stats_latest" (
	"universe_id" bigint PRIMARY KEY NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"latest_ccu" integer DEFAULT 0 NOT NULL,
	"trend_score" double precision,
	"velocity" double precision,
	"spike_score" double precision,
	"lifecycle" "lifecycle_stage",
	"pulse_stage" "pulse_stage",
	"spark" jsonb,
	"delta_24h_pct" double precision,
	"velocity_change_24h_pct" double precision,
	"annotation" text,
	"genre_percentile" double precision
);
--> statement-breakpoint
ALTER TABLE "game_stats" ADD COLUMN "pulse_stage" "pulse_stage";--> statement-breakpoint
ALTER TABLE "game_stats" ADD COLUMN "spark" jsonb;--> statement-breakpoint
ALTER TABLE "game_stats" ADD COLUMN "delta_24h_pct" double precision;--> statement-breakpoint
ALTER TABLE "game_stats" ADD COLUMN "velocity_change_24h_pct" double precision;--> statement-breakpoint
ALTER TABLE "game_stats" ADD COLUMN "annotation" text;--> statement-breakpoint
ALTER TABLE "cohort_stats" ADD CONSTRAINT "cohort_stats_universe_id_games_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."games"("universe_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_stats_latest" ADD CONSTRAINT "game_stats_latest_universe_id_games_universe_id_fk" FOREIGN KEY ("universe_id") REFERENCES "public"."games"("universe_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gsl_spike_ccu_idx" ON "game_stats_latest" USING btree ("spike_score","latest_ccu");--> statement-breakpoint
CREATE INDEX "gsl_trend_idx" ON "game_stats_latest" USING btree ("trend_score");--> statement-breakpoint
CREATE INDEX "gsl_ccu_idx" ON "game_stats_latest" USING btree ("latest_ccu");--> statement-breakpoint
CREATE INDEX "gsl_delta_idx" ON "game_stats_latest" USING btree ("delta_24h_pct");--> statement-breakpoint
CREATE INDEX "gsl_pulse_stage_idx" ON "game_stats_latest" USING btree ("pulse_stage");--> statement-breakpoint
CREATE INDEX "gsl_computed_idx" ON "game_stats_latest" USING btree ("computed_at");