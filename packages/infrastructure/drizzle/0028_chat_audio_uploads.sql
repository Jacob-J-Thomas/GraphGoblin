CREATE TABLE `chat_audio_uploads` (
  `owner_id` text NOT NULL,
  `audience_key` text NOT NULL,
  `upload_id` text NOT NULL,
  `declared_digest` text NOT NULL,
  `audio_id` text,
  `state` text NOT NULL,
  `failure_code` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_audio_upload_identity_idx` ON `chat_audio_uploads` (`owner_id`,`audience_key`,`upload_id`);
