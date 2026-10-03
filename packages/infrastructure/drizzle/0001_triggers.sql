CREATE TABLE `inbound_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`dedupe_key` text,
	`source` text NOT NULL,
	`received_at` text NOT NULL,
	`run_ids` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inbound_events_owner_idx` ON `inbound_events` (`owner_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `inbound_events_type_dedupe_idx` ON `inbound_events` (`owner_id`,`type`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `inbound_events_source_dedupe_idx` ON `inbound_events` (`owner_id`,`source`,`dedupe_key`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`loop_id` text NOT NULL,
	`version_id` text NOT NULL,
	`trigger_node_id` text NOT NULL,
	`expression` text NOT NULL,
	`timezone` text NOT NULL,
	`missed_fire_policy` text NOT NULL,
	`enabled` integer NOT NULL,
	`next_fire_at` text,
	`last_fired_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `schedules_due_idx` ON `schedules` (`enabled`,`next_fire_at`);--> statement-breakpoint
CREATE INDEX `schedules_loop_idx` ON `schedules` (`loop_id`,`version_id`);--> statement-breakpoint
CREATE TABLE `webhook_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`loop_id` text NOT NULL,
	`version_id` text NOT NULL,
	`trigger_node_id` text NOT NULL,
	`token` text NOT NULL,
	`secret_ref` text NOT NULL,
	`signature_header` text NOT NULL,
	`replay_window_seconds` integer NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhook_endpoints_token_idx` ON `webhook_endpoints` (`token`);--> statement-breakpoint
CREATE INDEX `webhook_endpoints_loop_idx` ON `webhook_endpoints` (`loop_id`,`version_id`);