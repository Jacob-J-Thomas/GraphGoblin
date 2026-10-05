CREATE TABLE `classifier_models` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`display_name` text NOT NULL,
	`source` text NOT NULL,
	`provider` text NOT NULL,
	`provider_model` text NOT NULL,
	`primitives` text NOT NULL,
	`endpoint` text NOT NULL,
	`secret_ref` text,
	`enabled` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
