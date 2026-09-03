CREATE TABLE `model_configs` (
	`key` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`endpoint_override` text,
	`capabilities_json` text,
	`health_status` text DEFAULT 'unknown' NOT NULL,
	`health_message` text,
	`failure_streak` integer DEFAULT 0 NOT NULL,
	`health_checked_at` integer,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `model_configs_health_updated_idx` ON `model_configs` (`health_status`,`updated_at`);