import { nanoid } from "nanoid";

import type {
  CreateProjectInput,
  Project,
  RepositoryConfig,
  UpdateProjectInput,
} from "../../../../../packages/contracts/src/index.js";
import { nowIso } from "../time.js";

import {
  defaultMaxConcurrentSessions,
  mapProject,
  mapRepository,
  normalizeOptionalCommand,
  normalizeOptionalModel,
  normalizeOptionalReasoningEffort,
  normalizeReviewAction,
  requireValue,
  type SqliteStoreContext,
  slugify,
  stringifyJson,
} from "./shared.js";

export class ProjectRepository {
  constructor(private readonly context: SqliteStoreContext) {}

  listProjects(): Project[] {
    const rows = this.context.db
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC, name ASC")
      .all() as Record<string, unknown>[];
    return rows.map(mapProject);
  }

  getProject(projectId: string): Project | undefined {
    const row = this.context.db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(projectId) as Record<string, unknown> | undefined;
    return row ? mapProject(row) : undefined;
  }

  getRepository(repositoryId: string): RepositoryConfig | undefined {
    const row = this.context.db
      .prepare("SELECT * FROM repositories WHERE id = ?")
      .get(repositoryId) as Record<string, unknown> | undefined;
    return row ? mapRepository(row) : undefined;
  }

  listProjectRepositories(projectId: string): RepositoryConfig[] {
    const rows = this.context.db
      .prepare(
        "SELECT * FROM repositories WHERE project_id = ? ORDER BY created_at ASC",
      )
      .all(projectId) as Record<string, unknown>[];
    return rows.map(mapRepository);
  }

  createProject(input: CreateProjectInput): {
    project: Project;
    repository: RepositoryConfig;
  } {
    const timestamp = nowIso();
    const projectId = nanoid();
    const repositoryId = nanoid();
    const slug = slugify(input.slug ?? input.name);
    const defaultTargetBranch = input.default_target_branch ?? "main";

    this.context.db
      .prepare(
        `
          INSERT INTO projects (
            id, slug, name, agent_adapter, execution_backend, default_target_branch, pre_worktree_command,
            post_worktree_command, default_review_action, draft_analysis_model,
            draft_analysis_reasoning_effort, ticket_work_model,
            ticket_work_reasoning_effort, max_concurrent_sessions, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        projectId,
        slug,
        input.name.trim(),
        "codex",
        "host",
        defaultTargetBranch,
        null,
        null,
        "direct_merge",
        null,
        null,
        null,
        null,
        defaultMaxConcurrentSessions,
        timestamp,
        timestamp,
      );

    this.context.db
      .prepare(
        `
          INSERT INTO repositories (
            id, project_id, name, path, target_branch, setup_hook, cleanup_hook,
            validation_profile, extra_env_allowlist, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        repositoryId,
        projectId,
        input.repository.name.trim(),
        input.repository.path,
        input.repository.target_branch ?? defaultTargetBranch,
        null,
        null,
        stringifyJson(
          (input.repository.validation_commands ?? []).map(
            (command, index) => ({
              id: nanoid(),
              label: `Validation ${index + 1}`,
              command: command.trim(),
              working_directory: input.repository.path,
              timeout_ms: 300_000,
              required_for_review: true,
              shell: true,
            }),
          ),
        ),
        stringifyJson([]),
        timestamp,
        timestamp,
      );

    return {
      project: requireValue(
        this.getProject(projectId),
        "Project not found after creation",
      ),
      repository: requireValue(
        this.listProjectRepositories(projectId)[0],
        "Repository not found after creation",
      ),
    };
  }

  updateProject(projectId: string, input: UpdateProjectInput): Project {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    const draftAnalysisModel =
      input.draft_analysis_model === undefined
        ? project.draft_analysis_model
        : normalizeOptionalModel(input.draft_analysis_model);
    const agentAdapter =
      input.agent_adapter === undefined
        ? project.agent_adapter
        : input.agent_adapter;
    const executionBackend =
      input.execution_backend === undefined
        ? project.execution_backend
        : input.execution_backend;
    const preWorktreeCommand =
      input.pre_worktree_command === undefined
        ? project.pre_worktree_command
        : normalizeOptionalCommand(input.pre_worktree_command);
    const defaultReviewAction =
      input.default_review_action === undefined
        ? project.default_review_action
        : normalizeReviewAction(input.default_review_action);
    const postWorktreeCommand =
      input.post_worktree_command === undefined
        ? project.post_worktree_command
        : normalizeOptionalCommand(input.post_worktree_command);
    const draftAnalysisReasoningEffort =
      input.draft_analysis_reasoning_effort === undefined
        ? project.draft_analysis_reasoning_effort
        : normalizeOptionalReasoningEffort(
            input.draft_analysis_reasoning_effort,
          );
    const ticketWorkModel =
      input.ticket_work_model === undefined
        ? project.ticket_work_model
        : normalizeOptionalModel(input.ticket_work_model);
    const ticketWorkReasoningEffort =
      input.ticket_work_reasoning_effort === undefined
        ? project.ticket_work_reasoning_effort
        : normalizeOptionalReasoningEffort(input.ticket_work_reasoning_effort);
    const repositoryTargetBranchUpdates =
      input.repository_target_branches ?? [];
    const timestamp = nowIso();

    for (const repositoryUpdate of repositoryTargetBranchUpdates) {
      const repository = this.getRepository(repositoryUpdate.repository_id);
      if (!repository || repository.project_id !== projectId) {
        throw new Error("Repository not found");
      }
    }

    this.context.db
      .prepare(
        `
          UPDATE projects
          SET agent_adapter = ?,
              execution_backend = ?,
              default_review_action = ?,
              pre_worktree_command = ?,
              post_worktree_command = ?,
              draft_analysis_model = ?,
              draft_analysis_reasoning_effort = ?,
              ticket_work_model = ?,
              ticket_work_reasoning_effort = ?,
              updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        agentAdapter,
        executionBackend,
        defaultReviewAction,
        preWorktreeCommand,
        postWorktreeCommand,
        draftAnalysisModel,
        draftAnalysisReasoningEffort,
        ticketWorkModel,
        ticketWorkReasoningEffort,
        timestamp,
        projectId,
      );

    for (const repositoryUpdate of repositoryTargetBranchUpdates) {
      this.context.db
        .prepare(
          `
            UPDATE repositories
            SET target_branch = ?,
                updated_at = ?
            WHERE id = ?
          `,
        )
        .run(
          repositoryUpdate.target_branch,
          timestamp,
          repositoryUpdate.repository_id,
        );
    }

    return requireValue(
      this.getProject(projectId),
      "Project not found after update",
    );
  }
}
