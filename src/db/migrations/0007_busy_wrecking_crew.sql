CREATE TABLE `tool_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`tool_call_id` text NOT NULL,
	`approval_id` text,
	`decision` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`risk_categories` text NOT NULL,
	`metadata` text,
	`requested_at` integer NOT NULL,
	`responded_at` integer,
	`reason` text,
	FOREIGN KEY (`tool_call_id`) REFERENCES `tool_calls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tool_approvals_tool_call_id_idx` ON `tool_approvals` (`tool_call_id`);--> statement-breakpoint
CREATE INDEX `tool_approvals_approval_id_idx` ON `tool_approvals` (`approval_id`);--> statement-breakpoint
CREATE TABLE `tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`step_number` integer,
	`status` text NOT NULL,
	`input_summary` text,
	`approval_decision` text,
	`output_summary` text,
	`exit_code` integer,
	`error` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`duration_ms` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tool_calls_run_id_idx` ON `tool_calls` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tool_calls_run_tool_call_id_unique` ON `tool_calls` (`run_id`,`tool_call_id`);--> statement-breakpoint
CREATE INDEX `tool_calls_started_at_idx` ON `tool_calls` (`started_at`);--> statement-breakpoint
ALTER TABLE `runs` ADD `provider` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `cost_metadata` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `step_count` integer;--> statement-breakpoint
CREATE INDEX `memories_updated_at_idx` ON `memories` (`updated_at`);--> statement-breakpoint
CREATE INDEX `messages_session_id_idx` ON `messages` (`session_id`);--> statement-breakpoint
CREATE INDEX `sessions_updated_at_idx` ON `sessions` (`updated_at`);--> statement-breakpoint
CREATE INDEX `sessions_project_id_idx` ON `sessions` (`project_id`);