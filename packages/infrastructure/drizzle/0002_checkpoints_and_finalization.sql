ALTER TABLE `runs` ADD `thread_snapshot_seq` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `finalized_at` text;--> statement-breakpoint
UPDATE `runs` SET `finalized_at` = coalesce(`finished_at`, `created_at`) WHERE `status` IN ('succeeded', 'failed', 'cancelled', 'exhausted');
