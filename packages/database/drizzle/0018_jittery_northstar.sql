CREATE TYPE "public"."finance_currency" AS ENUM('usd', 'robux');--> statement-breakpoint
CREATE TYPE "public"."finance_display_currency" AS ENUM('usd', 'robux', 'both');--> statement-breakpoint
CREATE TYPE "public"."finance_expense_status" AS ENUM('paid', 'owed');--> statement-breakpoint
CREATE TYPE "public"."finance_kind" AS ENUM('revenue', 'expense', 'cashout', 'investment', 'distribution');--> statement-breakpoint
CREATE TYPE "public"."finance_person_rating" AS ENUM('good', 'mixed', 'avoid');--> statement-breakpoint
CREATE TABLE "finance_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"month" date NOT NULL,
	"amount_usd" numeric(12, 2) NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "finance_budgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "finance_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "finance_settings" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"devex_rate" numeric(8, 6) DEFAULT 0.0038 NOT NULL,
	"display_currency" "finance_display_currency" DEFAULT 'both' NOT NULL,
	"opening_usd" numeric(12, 2),
	"opening_robux" bigint,
	"opening_set_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "finance_split_accruals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"split_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"revenue_tx_id" uuid NOT NULL,
	"occurred_on" date NOT NULL,
	"currency" "finance_currency" NOT NULL,
	"amount_native" numeric(14, 2) NOT NULL,
	"amount_usd" numeric(12, 2) NOT NULL,
	"rate_used" numeric(8, 6) NOT NULL,
	"percent_used" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_split_accruals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "finance_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"kind" "finance_kind" NOT NULL,
	"occurred_on" date NOT NULL,
	"description" text NOT NULL,
	"currency" "finance_currency",
	"amount_gross" numeric(14, 2),
	"fee_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"amount_net" numeric(14, 2),
	"cost_amount" numeric(14, 2),
	"rate_used" numeric(8, 6) NOT NULL,
	"amount_usd" numeric(12, 2) NOT NULL,
	"category_id" uuid,
	"person_id" uuid,
	"method" text,
	"status" "finance_expense_status" DEFAULT 'paid' NOT NULL,
	"paid_on" date,
	"robux_out" bigint,
	"usd_in" numeric(12, 2),
	"split_id" uuid,
	"milestone_id" uuid,
	"task_id" uuid,
	"payment_ref" text,
	"receipt_url" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"discord_handle" text NOT NULL,
	"display_name" text,
	"roblox_user_id" bigint,
	"roblox_username" text,
	"avatar_url" text,
	"roles" text[] DEFAULT '{}' NOT NULL,
	"preferred_method" text,
	"default_rate_usd" numeric(12, 2),
	"rating" "finance_person_rating",
	"note" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "revenue_splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"percent" numeric(5, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "revenue_splits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finance_budgets" ADD CONSTRAINT "finance_budgets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_categories" ADD CONSTRAINT "finance_categories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_split_accruals" ADD CONSTRAINT "finance_split_accruals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_split_accruals" ADD CONSTRAINT "finance_split_accruals_split_id_revenue_splits_id_fk" FOREIGN KEY ("split_id") REFERENCES "public"."revenue_splits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_split_accruals" ADD CONSTRAINT "finance_split_accruals_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_split_accruals" ADD CONSTRAINT "finance_split_accruals_revenue_tx_id_finance_transactions_id_fk" FOREIGN KEY ("revenue_tx_id") REFERENCES "public"."finance_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_category_id_finance_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."finance_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_split_id_revenue_splits_id_fk" FOREIGN KEY ("split_id") REFERENCES "public"."revenue_splits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_splits" ADD CONSTRAINT "revenue_splits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_splits" ADD CONSTRAINT "revenue_splits_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_budgets_project_month_uq" ON "finance_budgets" USING btree ("project_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_categories_project_name_uq" ON "finance_categories" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "finance_accruals_project_date_idx" ON "finance_split_accruals" USING btree ("project_id","occurred_on");--> statement-breakpoint
CREATE INDEX "finance_accruals_person_currency_idx" ON "finance_split_accruals" USING btree ("person_id","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_tx_project_ref_uq" ON "finance_transactions" USING btree ("project_id","ref");--> statement-breakpoint
CREATE INDEX "finance_tx_project_date_idx" ON "finance_transactions" USING btree ("project_id","occurred_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "finance_tx_project_kind_status_idx" ON "finance_transactions" USING btree ("project_id","kind","status");--> statement-breakpoint
CREATE INDEX "finance_tx_person_idx" ON "finance_transactions" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_project_handle_uq" ON "people" USING btree ("project_id","discord_handle");--> statement-breakpoint
CREATE INDEX "revenue_splits_project_from_idx" ON "revenue_splits" USING btree ("project_id","effective_from");--> statement-breakpoint
CREATE POLICY "finance_budgets_owner_rw" ON "finance_budgets" AS PERMISSIVE FOR ALL TO public USING (is_project_owner("finance_budgets"."project_id")) WITH CHECK (is_project_owner("finance_budgets"."project_id"));--> statement-breakpoint
CREATE POLICY "finance_categories_owner_rw" ON "finance_categories" AS PERMISSIVE FOR ALL TO public USING (is_project_owner("finance_categories"."project_id")) WITH CHECK (is_project_owner("finance_categories"."project_id"));--> statement-breakpoint
CREATE POLICY "finance_settings_owner_rw" ON "finance_settings" AS PERMISSIVE FOR ALL TO public USING (is_project_owner("finance_settings"."project_id")) WITH CHECK (is_project_owner("finance_settings"."project_id"));--> statement-breakpoint
CREATE POLICY "finance_accruals_owner_rw" ON "finance_split_accruals" AS PERMISSIVE FOR ALL TO public USING (is_project_owner("finance_split_accruals"."project_id")) WITH CHECK (is_project_owner("finance_split_accruals"."project_id"));--> statement-breakpoint
CREATE POLICY "finance_tx_owner_rw" ON "finance_transactions" AS PERMISSIVE FOR ALL TO public USING (is_project_owner("finance_transactions"."project_id")) WITH CHECK (is_project_owner("finance_transactions"."project_id"));--> statement-breakpoint
CREATE POLICY "people_owner_rw" ON "people" AS PERMISSIVE FOR ALL TO public USING (is_project_owner("people"."project_id")) WITH CHECK (is_project_owner("people"."project_id"));--> statement-breakpoint
CREATE POLICY "revenue_splits_owner_rw" ON "revenue_splits" AS PERMISSIVE FOR ALL TO public USING (is_project_owner("revenue_splits"."project_id")) WITH CHECK (is_project_owner("revenue_splits"."project_id"));