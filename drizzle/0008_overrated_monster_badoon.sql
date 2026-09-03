CREATE INDEX `asset_comments_asset_created_idx` ON `asset_comments` (`asset_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `assets_project_created_idx` ON `assets` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `assets_project_kind_created_idx` ON `assets` (`project_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `characters_project_created_idx` ON `characters` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `storyboards_project_created_idx` ON `storyboards` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_project_created_idx` ON `tasks` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_user_status_created_idx` ON `tasks` (`user_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_status_ark_idx` ON `tasks` (`status`,`ark_task_id`);