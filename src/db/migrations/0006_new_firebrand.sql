CREATE TABLE `mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`namespace` text NOT NULL,
	`transport` text NOT NULL,
	`config` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_status` text DEFAULT 'untested' NOT NULL,
	`last_error` text,
	`last_checked_at` integer,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_servers_namespace_unique` ON `mcp_servers` (`namespace`);--> statement-breakpoint
CREATE TABLE `mcp_trust_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`mcp_server_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`decision` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`mcp_server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_trust_decisions_server_fingerprint_unique` ON `mcp_trust_decisions` (`mcp_server_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `mcp_trust_decisions_server_idx` ON `mcp_trust_decisions` (`mcp_server_id`);