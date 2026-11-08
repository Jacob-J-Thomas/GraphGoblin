CREATE TABLE `chat_audio` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`audience_key` text NOT NULL,
	`mime_type` text,
	`bytes` integer,
	`sha256` text,
	`path` text,
	`expires_at` text NOT NULL,
	`consumed_turn_id` text,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_audio_scope_idx` ON `chat_audio` (`owner_id`,`audience_key`,`state`);--> statement-breakpoint
CREATE INDEX `chat_audio_cleanup_idx` ON `chat_audio` (`state`,`expires_at`);--> statement-breakpoint
CREATE TABLE `chat_bindings` (
	`owner_id` text NOT NULL,
	`audience_key` text NOT NULL,
	`loop_id` text NOT NULL,
	`protocol` text NOT NULL,
	PRIMARY KEY(`owner_id`, `audience_key`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_bindings_loop_idx` ON `chat_bindings` (`loop_id`);--> statement-breakpoint
CREATE TABLE `chat_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`audience_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_turn` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_conversations_owner_idx` ON `chat_conversations` (`owner_id`,`audience_key`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `chat_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_devices_token_idx` ON `chat_devices` (`token_hash`);--> statement-breakpoint
CREATE INDEX `chat_devices_owner_idx` ON `chat_devices` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `chat_pairings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`claim_id` text,
	`claimed_device_id` text,
	`claimed_token_hash` text,
	`claimed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_pairings_code_idx` ON `chat_pairings` (`code_hash`);--> statement-breakpoint
CREATE TABLE `chat_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`audience_key` text NOT NULL,
	`conversation_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`turn` integer NOT NULL,
	`run_id` text NOT NULL,
	`input` text,
	`created_at` text NOT NULL,
	`history_deleted` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_turns_request_idx` ON `chat_turns` (`conversation_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_turns_counter_idx` ON `chat_turns` (`conversation_id`,`turn`);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_turns_run_idx` ON `chat_turns` (`run_id`);