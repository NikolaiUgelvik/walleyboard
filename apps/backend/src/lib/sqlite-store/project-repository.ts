import { projectsTable, repositoriesTable } from "@walleyboard/db";
import { asc, desc, eq } from "drizzle-orm";
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
    const rows = this.context.db
      .select()
      .from(projectsTable)
      .orderBy(desc(projectsTable.updatedAt), asc(projectsTable.name))
      .all();
    return rows.map(mapProject);
  }

  getProject(projectId: string): Project | undefined {
    const row = this.context.db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .get();
    return row ? mapProject(row) : undefined;
  }

  getRepository(repositoryId: string): RepositoryConfig | undefined {
    const row = this.context.db
      .select()
      .from(repositoriesTable)
      .where(eq(repositoriesTable.id, repositoryId))
      .get();
    return row ? mapRepository(row) : undefined;
  }

  listProjectRepositories(projectId: string): RepositoryConfig[] {
    const rows = this.context.db
      .select()
      .from(repositoriesTable)
      .where(eq(repositoriesTable.projectId, projectId))
      .orderBy(asc(repositoriesTable.createdAt))
      .all();
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

    this.context.db
      .insert(projectsTable)
      .values({
        id: projectId,
        slug,
        name: input.name.trim(),
        color,
        agentAdapter: "codex",
        draftAnalysisAgentAdapter: "codex",
        ticketWorkAgentAdapter: "codex",
        executionBackend: "docker",
        disabledMcpServers: [],
        automaticAgentReview: false,
        automaticAgentReviewRunLimit: 1,
        defaultReviewAction: "direct_merge",
        defaultTargetBranch,
        previewStartCommand: null,
        preWorktreeCommand: null,
        postWorktreeCommand: null,
        draftAnalysisModel: null,
        draftAnalysisReasoningEffort: null,
        ticketWorkModel: null,
        ticketWorkReasoningEffort: null,
        maxConcurrentSessions: defaultMaxConcurrentSessions,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    this.context.db
      .insert(repositoriesTable)
      .values({
        id: repositoryId,
        projectId,
        name: input.repository.name.trim(),
        path: input.repository.path,
        targetBranch: input.repository.target_branch ?? defaultTargetBranch,
        setupHook: null,
        cleanupHook: null,
        validationProfile: (input.repository.validation_commands ?? []).map(
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
        extraEnvAllowlist: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

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
    const draftAnalysisAgentAdapter =
      input.draft_analysis_agent_adapter === undefined
        ? project.draft_analysis_agent_adapter
        : input.draft_analysis_agent_adapter;
    const ticketWorkAgentAdapter =
      input.ticket_work_agent_adapter === undefined
        ? project.ticket_work_agent_adapter
        : input.ticket_work_agent_adapter;
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
      agentAdapter: draftAnalysisAgentAdapter,
      executionBackend,
    });
    this.#assertSupportedExecutionConfiguration({
      agentAdapter: ticketWorkAgentAdapter,
      executionBackend,
    });

    for (const repositoryUpdate of repositoryTargetBranchUpdates) {
      const repository = this.getRepository(repositoryUpdate.repository_id);
      if (!repository || repository.project_id !== projectId) {
        throw new Error("Repository not found");
      }
    }

    this.context.db
      .update(projectsTable)
      .set({
        color,
        draftAnalysisAgentAdapter,
        ticketWorkAgentAdapter,
        executionBackend,
        disabledMcpServers,
        automaticAgentReview,
        automaticAgentReviewRunLimit,
        defaultReviewAction,
        previewStartCommand,
        preWorktreeCommand,
        postWorktreeCommand,
        draftAnalysisModel,
        draftAnalysisReasoningEffort,
        ticketWorkModel,
        ticketWorkReasoningEffort,
        updatedAt: timestamp,
      })
      .where(eq(projectsTable.id, projectId))
      .run();

    for (const repositoryUpdate of repositoryTargetBranchUpdates) {
      this.context.db
        .update(repositoriesTable)
        .set({
          targetBranch: repositoryUpdate.target_branch,
          updatedAt: timestamp,
        })
        .where(eq(repositoriesTable.id, repositoryUpdate.repository_id))
        .run();
    }

    return requireValue(
      this.getProject(projectId),
      "Project not found after update",
    );
  }
}
