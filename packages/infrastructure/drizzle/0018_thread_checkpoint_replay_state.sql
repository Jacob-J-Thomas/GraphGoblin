-- ADR-0053: only a checkpoint writer can prove the open visit. Existing caches remain unproven.
ALTER TABLE `runs` ADD `thread_snapshot_replay_state` text;
