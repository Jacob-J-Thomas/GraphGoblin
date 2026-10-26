CREATE TABLE `run_resource_uses` (
	`run_id` text NOT NULL,
	`key` text NOT NULL,
	`path` text NOT NULL,
	PRIMARY KEY(`run_id`, `key`)
);
--> statement-breakpoint
CREATE INDEX `run_resource_uses_key_idx` ON `run_resource_uses` (`key`);--> statement-breakpoint
CREATE TABLE `run_resources` (
	`key` text PRIMARY KEY NOT NULL,
	`owner_run_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`identity` text NOT NULL,
	`approval` text,
	`pending` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `run_resources_owner_idx` ON `run_resources` (`owner_run_id`);--> statement-breakpoint
CREATE INDEX `run_resources_pending_idx` ON `run_resources` (`pending`,`key`);
