CREATE TABLE `project_preferences` (
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`last_opened_at` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `project_id`)
);
--> statement-breakpoint
CREATE INDEX `project_preferences_user_favorite_idx` ON `project_preferences` (`user_id`,`favorite`,`updated_at`);--> statement-breakpoint
CREATE INDEX `project_preferences_user_opened_idx` ON `project_preferences` (`user_id`,`last_opened_at`);