CREATE TABLE `model_discovery` (
	`harness` text NOT NULL,
	`model` text NOT NULL,
	`digest` text NOT NULL,
	`connection_revision` integer NOT NULL,
	`availability` text NOT NULL,
	`thinking_by_effort` text NOT NULL,
	PRIMARY KEY(`harness`, `model`)
);
--> statement-breakpoint
CREATE TABLE `ollama_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`base_url` text NOT NULL,
	`revision` integer NOT NULL,
	`discovery` text NOT NULL
);
