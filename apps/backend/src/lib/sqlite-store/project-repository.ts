import { sql } from "drizzle-orm";
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
  normalizeProjectColor,
  normalizeReviewAction,
  requireValue,
  type SqliteStoreContext,
  slugify,
  stringifyJson,
} from "./shared.js";

export class ProjectRepository {
  constructor(private readonly context: SqliteStoreContext) {}

  #assertSupportedExecutionConfiguration(input: {
    agentAdapter: Project["agent_adapter"];
    executionBackend: Project["execution_backend"];
  }): void {
    if (input.executionBackend !== "docker") {
      throw new Error("Docker is the only supported execution backend.");
    }

    if (
      input.agentAdapter !== "codex" &&
      input.agentAdapter !== "claude-code"
    ) {
      throw new Error(
        "WalleyBoard supports only Codex or Claude Code for Docker-backed ticket execution.",
      );
    }
  }

  listProjects(): Project[] {
    const rows = this.context.db.all<Record<string, unknown>>(sql`
      SELECT *
      FROM projects
      ORDER BY updated_at DESC, name ASC
    `);
    return rows.map(mapProject);
  }

  getProject(projectId: string): Project | undefined {
    const row = this.context.db.get<Record<string, unknown>>(sql`
      SELECT *
      FROM projects
      WHERE id = ${projectId}
    `);
    return row ? mapProject(row) : undefined;
  }

  getRepository(repositoryId: string): RepositoryConfig | undefined {
    const row = this.context.db.get<Record<string, unknown>>(sql`
      SELECT *
      FROM repositories
      WHERE id = ${repositoryId}
    `);
    return row ? mapRepository(row) : undefined;
  }

  listProjectRepositories(projectId: string): RepositoryConfig[] {
    const rows = this.context.db.all<Record<string, unknown>>(sql`
      SELECT *
      FROM repositories
      WHERE project_id = ${projectId}
      ORDER BY created_at ASC
    `);
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
    const color = normalizeProjectColor(input.color);
    const defaultTargetBranch = input.default_target_branch ?? "main";

    this.context.db.run(sql`
      INSERT INTO projects (
        id, slug, name, color, agent_adapter, execution_backend, disabled_mcp_servers, automatic_agent_review, default_target_branch, pre_worktree_command,
        automatic_agent_review_run_limit, post_worktree_command, preview_start_command, default_review_action,
        draft_analysis_model, draft_analysis_reasoning_effort,
        ticket_work_model, ticket_work_reasoning_effort,
        max_concurrent_sessions, created_at, updated_at
      ) VALUES (
        ${projectId},
        ${slug},
        ${input.name.trim()},
        ${color},
        ${"codex"},
        ${"docker"},
        ${stringifyJson([])},
        ${0},
        ${defaultTargetBranch},
        ${null},
        ${1},
        ${null},
        ${null},
        ${"direct_merge"},
        ${null},
        ${null},
        ${null},
        ${null},
        ${defaultMaxConcurrentSessions},
        ${timestamp},
        ${timestamp}
      )
    `);

    this.context.db.run(sql`
      INSERT INTO repositories (
        id, project_id, name, path, target_branch, setup_hook, cleanup_hook,
        validation_profile, extra_env_allowlist, created_at, updated_at
      ) VALUES (
        ${repositoryId},
        ${projectId},
        ${input.repository.name.trim()},
        ${input.repository.path},
        ${input.repository.target_branch ?? defaultTargetBranch},
        ${null},
        ${null},
        ${stringifyJson(
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
        )},
        ${stringifyJson([])},
        ${timestamp},
        ${timestamp}
      )
    `);

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
    const color =
      input.color === undefined
        ? normalizeProjectColor(project.color)
        : normalizeProjectColor(input.color);
    const agentAdapter =
      input.agent_adapter === undefined
        ? project.agent_adapter
        : input.agent_adapter;
    const executionBackend =
      input.execution_backend === undefined
        ? project.execution_backend
        : input.execution_backend;
    const disabledMcpServers =
      input.disabled_mcp_servers === undefined
        ? project.disabled_mcp_servers
        : Array.from(
            new Set(
              input.disabled_mcp_servers
                .map((server) => server.trim())
                .filter((server) => server.length > 0),
            ),
          ).sort((left, right) => left.localeCompare(right));
    const automaticAgentReview =
      input.automatic_agent_review === undefined
        ? project.automatic_agent_review
        : input.automatic_agent_review;
    const automaticAgentReviewRunLimit =
      input.automatic_agent_review_run_limit === undefined
        ? project.automatic_agent_review_run_limit
        : Math.max(1, input.automatic_agent_review_run_limit);
    const previewStartCommand =
      input.preview_start_command === undefined
        ? project.preview_start_command
        : normalizeOptionalCommand(input.preview_start_command);
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

    this.#assertSupportedExecutionConfiguration({
      agentAdapter,
      executionBackend,
    });

    for (const repositoryUpdate of repositoryTargetBranchUpdates) {
      const repository = this.getRepository(repositoryUpdate.repository_id);
      if (!repository || repository.project_id !== projectId) {
        throw new Error("Repository not found");
      }
    }

    this.context.db.run(sql`
      UPDATE projects
      SET color = ${color},
          agent_adapter = ${agentAdapter},
          execution_backend = ${executionBackend},
          disabled_mcp_servers = ${stringifyJson(disabledMcpServers)},
          automatic_agent_review = ${automaticAgentReview ? 1 : 0},
          automatic_agent_review_run_limit = ${automaticAgentReviewRunLimit},
          default_review_action = ${defaultReviewAction},
          preview_start_command = ${previewStartCommand},
          pre_worktree_command = ${preWorktreeCommand},
          post_worktree_command = ${postWorktreeCommand},
          draft_analysis_model = ${draftAnalysisModel},
          draft_analysis_reasoning_effort = ${draftAnalysisReasoningEffort},
          ticket_work_model = ${ticketWorkModel},
          ticket_work_reasoning_effort = ${ticketWorkReasoningEffort},
          updated_at = ${timestamp}
      WHERE id = ${projectId}
    `);

    for (const repositoryUpdate of repositoryTargetBranchUpdates) {
      this.context.db.run(sql`
        UPDATE repositories
        SET target_branch = ${repositoryUpdate.target_branch},
            updated_at = ${timestamp}
        WHERE id = ${repositoryUpdate.repository_id}
      `);
    }

    return requireValue(
      this.getProject(projectId),
      "Project not found after update",
    );
  }
}
