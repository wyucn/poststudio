ALTER TABLE `tasks` ADD `attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `started_at` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `completed_at` integer;