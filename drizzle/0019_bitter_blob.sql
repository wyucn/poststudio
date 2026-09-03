CREATE INDEX `assets_created_idx` ON `assets` (`created_at`);--> statement-breakpoint
CREATE INDEX `project_members_user_project_idx` ON `project_members` (`user_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `tasks_created_idx` ON `tasks` (`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_status_created_idx` ON `tasks` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `users_last_seen_idx` ON `users` (`last_seen_at`);