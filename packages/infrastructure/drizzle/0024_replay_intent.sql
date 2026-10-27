-- Add only intent metadata; #412 already owns the indexed replay_source_run_id.
-- Existing/pre-observation forks retain their source with both intent fields NULL.
-- A column CHECK keeps this migration additive, preserving #412 triggers and #418 indexes.
ALTER TABLE `runs` ADD `replay_intent_node_id` text;
--> statement-breakpoint
ALTER TABLE `runs` ADD `replay_intent_observed_seq` integer
  CONSTRAINT `runs_replay_intent_complete` CHECK (
    (replay_intent_node_id IS NULL AND replay_intent_observed_seq IS NULL)
    OR (replay_source_run_id IS NOT NULL AND replay_intent_node_id IS NOT NULL
      AND replay_intent_observed_seq IS NOT NULL AND replay_intent_observed_seq >= 0)
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_replay_intent_idx` ON `runs`
  (`replay_source_run_id`,`replay_intent_node_id`,`replay_intent_observed_seq`);
