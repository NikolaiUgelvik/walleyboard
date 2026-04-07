CREATE TABLE `draft_refine_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL REFERENCES `draft_ticket_states`(`id`) ON DELETE CASCADE,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
	`repository_id` text NOT NULL REFERENCES `repositories`(`id`) ON DELETE CASCADE,
	`adapter_session_ref` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`last_attempt_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_draft_refine_sessions_draft_id` ON `draft_refine_sessions` (`draft_id`);
