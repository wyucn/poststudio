CREATE TABLE `backup_media_tombstones` (
	`object_key` text PRIMARY KEY NOT NULL,
	`asset_id` text,
	`asset_json` text,
	`deleted_at` integer NOT NULL,
	`purge_after` integer NOT NULL,
	`remote_purged_at` integer
);
--> statement-breakpoint
CREATE INDEX `backup_media_tombstones_purge_idx` ON `backup_media_tombstones` (`remote_purged_at`,`purge_after`);