ALTER TABLE `projects` RENAME COLUMN `pre_worktree_command` TO `worktree_init_command`;--> statement-breakpoint
ALTER TABLE `projects` RENAME COLUMN `post_worktree_command` TO `worktree_teardown_command`;--> statement-breakpoint
ALTER TABLE `projects` ADD `worktree_init_run_sequential` integer DEFAULT false NOT NULL;