PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TEMP TABLE `__project_session_links` AS SELECT `id`, `project_id` FROM `sessions` WHERE `project_id` IS NOT NULL;--> statement-breakpoint
UPDATE `sessions` SET `project_id` = NULL WHERE `project_id` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`github_repo_id` integer,
	`github_installation_id` integer,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`full_name` text NOT NULL,
	`default_branch` text NOT NULL,
	`clone_url` text,
	`local_path` text NOT NULL,
	`status` text NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_projects`("id", "provider", "github_repo_id", "github_installation_id", "owner", "name", "full_name", "default_branch", "clone_url", "local_path", "status", "last_error", "created_at", "updated_at") SELECT "id", "provider", "github_repo_id", "github_installation_id", "owner", "name", "full_name", "default_branch", "clone_url", "local_path", "status", "last_error", "created_at", "updated_at" FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
UPDATE `sessions` SET `project_id` = (SELECT `project_id` FROM `__project_session_links` WHERE `__project_session_links`.`id` = `sessions`.`id`) WHERE `id` IN (SELECT `id` FROM `__project_session_links`);--> statement-breakpoint
DROP TABLE `__project_session_links`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_github_repo_id_unique` ON `projects` (`github_repo_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_local_path_unique` ON `projects` (`local_path`);
