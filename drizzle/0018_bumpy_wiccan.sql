CREATE TABLE `asset_transcripts` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text,
	`source_text` text,
	`corrected_text` text,
	`subtitle_srt` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `asset_transcripts_project_updated_idx` ON `asset_transcripts` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `asset_transcripts_task_idx` ON `asset_transcripts` (`task_id`);