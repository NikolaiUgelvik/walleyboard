CREATE TABLE `draft_ticket_states` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`artifact_scope_id` text NOT NULL,
	`title_draft` text NOT NULL,
	`description_draft` text NOT NULL,
	`proposed_repo_id` text,
	`confirmed_repo_id` text,
	`proposed_ticket_type` text,
	`proposed_acceptance_criteria` text NOT NULL,
	`wizard_status` text NOT NULL,
	`split_proposal_summary` text,
	`source_ticket_id` integer,
	`target_branch` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proposed_repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`confirmed_repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_drafts_project_id` ON `draft_ticket_states` (`project_id`);--> statement-breakpoint
CREATE TABLE `execution_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`status` text NOT NULL,
	`prompt_kind` text,
	`prompt` text,
	`pty_pid` integer,
	`started_at` text NOT NULL,
	`ended_at` text,
	`end_reason` text,
	FOREIGN KEY (`session_id`) REFERENCES `execution_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_execution_attempts_session_id` ON `execution_attempts` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_execution_attempts_session_attempt` ON `execution_attempts` (`session_id`,`attempt_number`);--> statement-breakpoint
CREATE TABLE `execution_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` integer NOT NULL,
	`project_id` text NOT NULL,
	`repo_id` text NOT NULL,
	`agent_adapter` text DEFAULT 'codex' NOT NULL,
	`worktree_path` text,
	`adapter_session_ref` text,
	`status` text NOT NULL,
	`planning_enabled` integer NOT NULL,
	`plan_status` text DEFAULT 'not_requested' NOT NULL,
	`plan_summary` text,
	`current_attempt_id` text,
	`latest_requested_change_note_id` text,
	`latest_review_package_id` text,
	`queue_entered_at` text,
	`started_at` text,
	`completed_at` text,
	`last_heartbeat_at` text,
	`last_summary` text,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_execution_sessions_ticket_id` ON `execution_sessions` (`ticket_id`);--> statement-breakpoint
CREATE INDEX `idx_execution_sessions_project_status_queue` ON `execution_sessions` (`project_id`,`status`,"queue_entered_at" asc,"started_at" asc);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`agent_adapter` text DEFAULT 'codex' NOT NULL,
	`execution_backend` text DEFAULT 'docker' NOT NULL,
	`disabled_mcp_servers` text DEFAULT '[]' NOT NULL,
	`automatic_agent_review` integer DEFAULT false NOT NULL,
	`automatic_agent_review_run_limit` integer DEFAULT 1 NOT NULL,
	`default_review_action` text DEFAULT 'direct_merge' NOT NULL,
	`default_target_branch` text,
	`preview_start_command` text,
	`pre_worktree_command` text,
	`post_worktree_command` text,
	`draft_analysis_model` text,
	`draft_analysis_reasoning_effort` text,
	`ticket_work_model` text,
	`ticket_work_reasoning_effort` text,
	`max_concurrent_sessions` integer DEFAULT 4 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`target_branch` text,
	`setup_hook` text,
	`cleanup_hook` text,
	`validation_profile` text NOT NULL,
	`extra_env_allowlist` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_repositories_project_id` ON `repositories` (`project_id`);--> statement-breakpoint
CREATE TABLE `requested_change_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` integer NOT NULL,
	`review_package_id` text,
	`author_type` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`review_package_id`) REFERENCES `review_packages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_requested_change_notes_ticket_id` ON `requested_change_notes` (`ticket_id`,"created_at" desc);--> statement-breakpoint
CREATE TABLE `review_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` integer NOT NULL,
	`session_id` text NOT NULL,
	`diff_ref` text NOT NULL,
	`commit_refs` text NOT NULL,
	`change_summary` text NOT NULL,
	`validation_results` text NOT NULL,
	`remaining_risks` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `execution_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_review_packages_ticket_id` ON `review_packages` (`ticket_id`,"created_at" desc);--> statement-breakpoint
CREATE TABLE `review_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` integer NOT NULL,
	`review_package_id` text NOT NULL,
	`implementation_session_id` text NOT NULL,
	`trigger_source` text DEFAULT 'manual' NOT NULL,
	`status` text NOT NULL,
	`adapter_session_ref` text,
	`prompt` text,
	`report` text,
	`failure_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`review_package_id`) REFERENCES `review_packages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`implementation_session_id`) REFERENCES `execution_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_review_runs_ticket_id` ON `review_runs` (`ticket_id`,"created_at" desc);--> statement-breakpoint
CREATE TABLE `session_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`line` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `execution_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_session_logs_session_id` ON `session_logs` (`session_id`,"id" asc);--> statement-breakpoint
CREATE TABLE `structured_events` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_entity` ON `structured_events` (`entity_type`,`entity_id`,"occurred_at" desc);--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`repo_id` text NOT NULL,
	`artifact_scope_id` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`ticket_type` text NOT NULL,
	`acceptance_criteria` text DEFAULT '[]' NOT NULL,
	`working_branch` text,
	`target_branch` text NOT NULL,
	`linked_pr` text,
	`session_id` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tickets_project_id` ON `tickets` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_tickets_session_id` ON `tickets` (`session_id`);