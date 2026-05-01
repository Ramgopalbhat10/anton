CREATE TABLE `github_installations` (
	`id` text PRIMARY KEY NOT NULL,
	`installation_id` integer NOT NULL,
	`account_login` text NOT NULL,
	`account_type` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_installations_installation_id_unique` ON `github_installations` (`installation_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`github_repo_id` integer NOT NULL,
	`github_installation_id` integer NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`full_name` text NOT NULL,
	`default_branch` text NOT NULL,
	`clone_url` text NOT NULL,
	`local_path` text NOT NULL,
	`status` text NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_github_repo_id_unique` ON `projects` (`github_repo_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_local_path_unique` ON `projects` (`local_path`);--> statement-breakpoint
CREATE TABLE `workspace_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`local_workspaces_root` text,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `project_id` text REFERENCES projects(id);