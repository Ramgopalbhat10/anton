CREATE TABLE `run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`label` text NOT NULL,
	`summary` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`duration_ms` integer,
	`tool_call_id` text,
	`details` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_events_run_id_sequence_idx` ON `run_events` (`run_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `run_events_tool_call_id_idx` ON `run_events` (`tool_call_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`duration_ms` integer,
	`total_tokens` integer,
	`finish_reason` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_session_id_idx` ON `runs` (`session_id`);--> statement-breakpoint
CREATE INDEX `runs_started_at_idx` ON `runs` (`started_at`);--> statement-breakpoint
ALTER TABLE `messages` ADD `metadata` text;