CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`label` text NOT NULL,
	`hash` text NOT NULL,
	`scopes` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE INDEX `api_keys_hash_idx` ON `api_keys` (`hash`);--> statement-breakpoint
CREATE TABLE `harness_sessions` (
	`run_id` text NOT NULL,
	`node_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`harness` text NOT NULL,
	`session_id` text,
	`status` text NOT NULL,
	`model` text,
	`effort` text,
	`scope_key` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`run_id`, `node_id`, `attempt`)
);
--> statement-breakpoint
CREATE INDEX `harness_sessions_scope_idx` ON `harness_sessions` (`scope_key`);--> statement-breakpoint
CREATE TABLE `loop_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`loop_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`definition` text NOT NULL,
	`created_at` text NOT NULL,
	`published_at` text
);
--> statement-breakpoint
CREATE INDEX `loop_versions_loop_idx` ON `loop_versions` (`loop_id`,`version`);--> statement-breakpoint
CREATE TABLE `loops` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`current_version_id` text,
	`draft_version_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `loops_owner_idx` ON `loops` (`owner_id`);--> statement-breakpoint
CREATE TABLE `model_catalog` (
	`harness` text NOT NULL,
	`model` text NOT NULL,
	`display_name` text NOT NULL,
	`efforts` text NOT NULL,
	`default_effort` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`harness`, `model`)
);
--> statement-breakpoint
CREATE TABLE `run_events` (
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`ts` text NOT NULL,
	`type` text NOT NULL,
	`node_id` text,
	`payload` text NOT NULL,
	PRIMARY KEY(`run_id`, `seq`)
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`loop_id` text NOT NULL,
	`version_id` text NOT NULL,
	`parent_run_id` text,
	`invocation_id` text NOT NULL,
	`status` text NOT NULL,
	`current_node_id` text,
	`iteration` integer NOT NULL,
	`waiting` text,
	`cancel_requested_at` text,
	`paused_at` text,
	`failure` text,
	`outcome` text,
	`result` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`last_event_seq` integer DEFAULT 0 NOT NULL,
	`initial_thread` text NOT NULL,
	`thread_snapshot` text
);
--> statement-breakpoint
CREATE INDEX `runs_owner_status_idx` ON `runs` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `runs_loop_idx` ON `runs` (`loop_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `runs_parent_idx` ON `runs` (`parent_run_id`);--> statement-breakpoint
CREATE TABLE `secrets` (
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`ciphertext` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `name`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`owner_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `timers` (
	`run_id` text NOT NULL,
	`key` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`run_id`, `key`)
);
--> statement-breakpoint
CREATE INDEX `timers_at_idx` ON `timers` (`at`);