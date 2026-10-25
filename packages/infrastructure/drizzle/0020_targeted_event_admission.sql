CREATE TABLE `event_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`loop_id` text NOT NULL,
	`version_id` text NOT NULL,
	`trigger_node_id` text NOT NULL,
	`inbound_id` text NOT NULL,
	`event_type` text NOT NULL,
	`request_key` text,
	`node_key` text,
	`status` text NOT NULL,
	`intent` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`failure_code` text,
	CONSTRAINT "event_receipt_status_check" CHECK("event_receipts"."status" IN ('deduplicated','pending','admitted','failed')),
	CONSTRAINT "event_receipt_intent_check" CHECK(("event_receipts"."status" = 'deduplicated' AND "event_receipts"."intent" IS NULL) OR ("event_receipts"."status" <> 'deduplicated' AND "event_receipts"."intent" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_receipts_inbound_idx` ON `event_receipts` (`inbound_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `event_receipts_request_idx` ON `event_receipts` (`owner_id`,`loop_id`,`trigger_node_id`,`event_type`,`request_key`);--> statement-breakpoint
CREATE INDEX `event_receipts_due_idx` ON `event_receipts` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `event_receipts_node_key_idx` ON `event_receipts` (`owner_id`,`loop_id`,`trigger_node_id`,`node_key`);