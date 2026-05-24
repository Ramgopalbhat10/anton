CREATE TABLE `background_command_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`command` text NOT NULL,
	`command_kind` text NOT NULL,
	`status` text NOT NULL,
	`pid` integer,
	`started_at` integer,
	`finished_at` integer,
	`exit_code` integer,
	`signal` text,
	`stdout_tail` text DEFAULT '' NOT NULL,
	`stderr_tail` text DEFAULT '' NOT NULL,
	`detected_urls` text DEFAULT '[]' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `background_command_sessions_project_id_idx` ON `background_command_sessions` (`project_id`);--> statement-breakpoint
CREATE INDEX `background_command_sessions_status_idx` ON `background_command_sessions` (`status`);--> statement-breakpoint
CREATE INDEX `background_command_sessions_project_started_idx` ON `background_command_sessions` (`project_id`,`started_at`);