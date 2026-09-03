CREATE TABLE `operation_health` (
	`key` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`metrics_json` text,
	`error_request_id` text,
	`alert_active` integer DEFAULT false NOT NULL,
	`last_run_at` integer NOT NULL,
	`last_success_at` integer,
	`last_failure_at` integer,
	`updated_at` integer NOT NULL
);
