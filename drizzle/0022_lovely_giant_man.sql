CREATE TABLE `product_events` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text,
	`asset_id` text,
	`model_key` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `product_events_project_created_idx` ON `product_events` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `product_events_task_action_idx` ON `product_events` (`task_id`,`action`);--> statement-breakpoint
CREATE INDEX `product_events_action_created_idx` ON `product_events` (`action`,`created_at`);