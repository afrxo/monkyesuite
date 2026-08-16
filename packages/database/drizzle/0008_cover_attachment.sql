-- Add cover image attachment reference to tasks.
-- No FK constraint — task_attachments already references tasks, adding the
-- reverse FK would be circular. Application logic enforces the relationship.
ALTER TABLE "tasks" ADD COLUMN "cover_attachment_id" uuid;
