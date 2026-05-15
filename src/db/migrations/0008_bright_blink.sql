CREATE TABLE `run_context_summaries` (
	`run_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`summary` text NOT NULL,
	`facts` text NOT NULL,
	`files` text NOT NULL,
	`commands` text NOT NULL,
	`tools` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_context_summaries_session_id_idx` ON `run_context_summaries` (`session_id`);--> statement-breakpoint
CREATE INDEX `run_context_summaries_created_at_idx` ON `run_context_summaries` (`created_at`);