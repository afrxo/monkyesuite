DROP POLICY "invites_member_rw" ON "invites" CASCADE;--> statement-breakpoint
DROP TABLE "invites" CASCADE;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DROP TYPE "public"."invite_status";