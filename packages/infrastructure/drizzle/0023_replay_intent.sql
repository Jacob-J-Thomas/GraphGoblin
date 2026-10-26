-- Additive to #412's 0021/0022: preserve every existing column, row, index and trigger.
-- A column CHECK avoids Drizzle Kit's table rebuild and its SQLite expression-index bug.
ALTER TABLE `runs` ADD `replay_intent_source_run_id` text;
--> statement-breakpoint
ALTER TABLE `runs` ADD `replay_intent_node_id` text;
--> statement-breakpoint
ALTER TABLE `runs` ADD `replay_intent_observed_seq` integer
  CONSTRAINT `runs_replay_intent_complete` CHECK (
    (replay_intent_source_run_id IS NULL AND replay_intent_node_id IS NULL AND replay_intent_observed_seq IS NULL)
    OR (replay_intent_source_run_id IS NOT NULL AND replay_intent_node_id IS NOT NULL
      AND replay_intent_observed_seq IS NOT NULL AND replay_intent_observed_seq >= 0)
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_replay_intent_idx` ON `runs`
  (`replay_intent_source_run_id`,`replay_intent_node_id`,`replay_intent_observed_seq`);
