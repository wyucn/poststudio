CREATE TABLE `asset_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`user_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `assets` ADD `review_status` text;