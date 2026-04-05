import type { FastifyPluginAsync, FastifyReply } from "fastify";

import {
  createProjectInputSchema,
  updateProjectInputSchema,
} from "../../../../packages/contracts/src/index.js";

import {
  assertAgentAdapterAvailable,
  createClaudeCodeAvailabilityGetter,
  type GetClaudeCodeAvailability,
} from "../lib/claude-code-availability.js";
import { makeCommandAck } from "../lib/command-ack.js";
import type { ExecutionRuntime } from "../lib/execution-runtime.js";
import { parseBody, parsePositiveInt } from "../lib/http.js";
import {
  commandRouteRateLimit,
  repositoryRouteRateLimit,
} from "../lib/rate-limit.js";
import type {
  ProjectPersistence,
  ProjectRoutePersistence,
} from "../lib/store.js";
import { removeProjectArtifacts } from "../lib/ticket-artifacts.js";
import type {
  RepositoryWorkspacePreview,
  TicketWorkspaceService,
} from "../lib/ticket-workspace-service.js";
import {
  fetchRepositoryBranches,
  removeLocalBranch,
  removePreparedWorktree,
} from "../lib/worktree-service.js";
import {
  attachWorkspaceTerminalSocket,
  type TerminalSocket,
} from "./workspace-terminal-socket.js";

type ProjectRouteOptions = {
  store: ProjectRoutePersistence;
  executionRuntime: ExecutionRuntime;
  ticketWorkspaceService: TicketWorkspaceService;
  getClaudeCodeAvailability?: GetClaudeCodeAvailability;
};

export function handleRepositoryWorkspaceTerminalConnection(
  socket: TerminalSocket,
  input: {
    executionRuntime: ExecutionRuntime;
    repository: ReturnType<ProjectPersistence["getRepository"]>;
  },
): void {
  const repository = input.repository;
  if (!repository) {
    socket.send(
      JSON.stringify({
        type: "terminal.error",
        message: "Repository not found",
      }),
    );
    socket.close();
    return;
  }

  attachWorkspaceTerminalSocket(socket, {
    sessionId: `repository-workspace:${repository.id}`,
    startWorkspaceTerminal: ({ sessionId, worktreePath }) =>
      input.executionRuntime.startWorkspaceTerminal({
        sessionId,
        worktreePath,
      }),
    worktreePath: repository.path,
  });
}

const activeProjectSessionStatuses = new Set([
  "queued",
  "running",
  "paused_checkpoint",
  "paused_user_control",
  "awaiting_input",
]);
const maxTicketReferenceSearchResults = 20;

export const projectRoutes: FastifyPluginAsync<ProjectRouteOptions> = async (
  app,
  {
    store,
    executionRuntime,
    ticketWorkspaceService,
    getClaudeCodeAvailability = createClaudeCodeAvailabilityGetter(),
  },
) => {
  const getProjectRepositoryPair = (
    projectId: string,
    repositoryId: string,
  ): {
    project: ReturnType<ProjectPersistence["getProject"]>;
    repository: ReturnType<ProjectPersistence["getRepository"]>;
  } => {
    const project = store.getProject(projectId);
    const repository = store.getRepository(repositoryId);
    if (!project || !repository || repository.project_id !== project.id) {
      return {
        project: undefined,
        repository: undefined,
      };
    }

    return { project, repository };
  };

  const buildRepositoryPreviewResponse = (
    repositoryId: string,
    preview: RepositoryWorkspacePreview,
  ) => ({
    preview: {
      repository_id: repositoryId,
      state: preview.state,
      preview_url: preview.preview_url,
      backend_url: preview.backend_url,
      started_at: preview.started_at,
      error: preview.error,
    },
  });

  const handleProjectUpdate = async (
    projectId: string,
    body: unknown,
    reply: FastifyReply,
  ) => {
    const input = parseBody(reply, updateProjectInputSchema, body);
    if (!input) {
      return;
    }

    try {
      const existingProject = store.getProject(projectId);
      if (!existingProject) {
        throw new Error("Project not found");
      }

      assertAgentAdapterAvailable(
        input.agent_adapter ?? existingProject.agent_adapter,
        getClaudeCodeAvailability,
      );

      const project = store.updateProject(projectId, input);
      reply.send(
        makeCommandAck(true, "Project options saved", {
          project_id: project.id,
        }),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to update project";
      reply
        .code(
          message === "Project not found" || message === "Repository not found"
            ? 404
            : 409,
        )
        .send({
          error: message,
        });
    }
  };

  app.get("/projects", async () => ({
    projects: store.listProjects(),
  }));

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId",
    async (request, reply) => {
      const project = store.getProject(request.params.projectId);

      if (!project) {
        reply.code(404).send({ error: "Project not found" });
        return;
      }

      return { project };
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/repositories",
    async (request) => ({
      repositories: store.listProjectRepositories(request.params.projectId),
    }),
  );

  app.get<{ Params: { projectId: string; repositoryId: string } }>(
    "/projects/:projectId/repositories/:repositoryId/workspace/preview",
    async (request, reply) => {
      const { project, repository } = getProjectRepositoryPair(
        request.params.projectId,
        request.params.repositoryId,
      );
      if (!project || !repository) {
        reply.code(404).send({ error: "Repository not found" });
        return;
      }

      return buildRepositoryPreviewResponse(
        repository.id,
        ticketWorkspaceService.getRepositoryPreview(repository.id),
      );
    },
  );

  app.post<{ Params: { projectId: string; repositoryId: string } }>(
    "/projects/:projectId/repositories/:repositoryId/workspace/preview",
    { preHandler: commandRouteRateLimit(app) },
    async (request, reply) => {
      const { project, repository } = getProjectRepositoryPair(
        request.params.projectId,
        request.params.repositoryId,
      );
      if (!project || !repository) {
        reply.code(404).send({ error: "Repository not found" });
        return;
      }

      try {
        const preview = await ticketWorkspaceService.ensureRepositoryPreview({
          repositoryId: repository.id,
          previewStartCommand: project.preview_start_command,
          worktreePath: repository.path,
        });
        reply.send(buildRepositoryPreviewResponse(repository.id, preview));
      } catch (error) {
        reply.code(409).send({
          error:
            error instanceof Error ? error.message : "Unable to start preview",
        });
      }
    },
  );

  app.post<{ Params: { projectId: string; repositoryId: string } }>(
    "/projects/:projectId/repositories/:repositoryId/workspace/preview/stop",
    { preHandler: commandRouteRateLimit(app) },
    async (request, reply) => {
      const { project, repository } = getProjectRepositoryPair(
        request.params.projectId,
        request.params.repositoryId,
      );
      if (!project || !repository) {
        reply.code(404).send({ error: "Repository not found" });
        return;
      }

      await ticketWorkspaceService.stopRepositoryPreviewAndWait(repository.id);
      reply.send(
        buildRepositoryPreviewResponse(
          repository.id,
          ticketWorkspaceService.getRepositoryPreview(repository.id),
        ),
      );
    },
  );
  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/repository-branches",
    { preHandler: repositoryRouteRateLimit(app) },
    async (request, reply) => {
      const project = store.getProject(request.params.projectId);
      if (!project) {
        reply.code(404).send({ error: "Project not found" });
        return;
      }

      return {
        repository_branches: store
          .listProjectRepositories(project.id)
          .map((repository) => {
            try {
              return {
                repository_id: repository.id,
                repository_name: repository.name,
                current_target_branch: repository.target_branch,
                branches: fetchRepositoryBranches(repository),
                error: null,
              };
            } catch (error) {
              return {
                repository_id: repository.id,
                repository_name: repository.name,
                current_target_branch: repository.target_branch,
                branches: [],
                error:
                  error instanceof Error
                    ? error.message
                    : "Unable to fetch repository branches",
              };
            }
          }),
      };
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/archived-tickets",
    async (request) => ({
      tickets: store.listProjectTickets(request.params.projectId, {
        archivedOnly: true,
      }),
    }),
  );

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/tickets",
    async (request) => ({
      tickets: store.listProjectTickets(request.params.projectId),
    }),
  );

  app.get<{
    Params: { projectId: string };
    Querystring: {
      limit?: string;
      query?: string;
    };
  }>("/projects/:projectId/ticket-references", async (request) => {
    const limit = Math.min(
      parsePositiveInt(request.query.limit ?? "") ??
        maxTicketReferenceSearchResults,
      maxTicketReferenceSearchResults,
    );

    return {
      ticket_references: store.searchProjectTicketReferences(
        request.params.projectId,
        {
          limit,
          query: request.query.query ?? "",
        },
      ),
    };
  });

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/drafts",
    async (request) => ({
      drafts: store.listProjectDrafts(request.params.projectId),
    }),
  );

  app.post(
    "/projects",
    { preHandler: app.rateLimit() },
    async (request, reply) => {
      const input = parseBody(reply, createProjectInputSchema, request.body);
      if (!input) {
        return;
      }

      try {
        const { project, repository } = store.createProject(input);

        reply.code(201).send(
          makeCommandAck(true, "Project created", {
            project_id: project.id,
            repo_id: repository.id,
          }),
        );
      } catch (error) {
        reply.code(409).send({
          error:
            error instanceof Error ? error.message : "Unable to create project",
        });
      }
    },
  );

  app.patch<{ Params: { projectId: string } }>(
    "/projects/:projectId",
    { preHandler: app.rateLimit() },
    async (request, reply) =>
      handleProjectUpdate(request.params.projectId, request.body, reply),
  );

  app.post<{ Params: { projectId: string } }>(
    "/projects/:projectId/update",
    { preHandler: app.rateLimit() },
    async (request, reply) =>
      handleProjectUpdate(request.params.projectId, request.body, reply),
  );

  app.post<{ Params: { projectId: string } }>(
    "/projects/:projectId/delete",
    { preHandler: commandRouteRateLimit(app) },
    async (request, reply) => {
      const project = store.getProject(request.params.projectId);
      if (!project) {
        reply.code(404).send({ error: "Project not found" });
        return;
      }

      const drafts = store.listProjectDrafts(project.id);
      const tickets = store.listProjectTickets(project.id, {
        includeArchived: true,
      });
      const activeDraft = drafts.find((draft) =>
        executionRuntime.hasActiveDraftRun(draft.id),
      );
      if (activeDraft) {
        reply.code(409).send({
          error: `Stop the active draft run for "${activeDraft.title_draft}" before deleting this project.`,
        });
        return;
      }

      const sessions = tickets.flatMap((ticket) => {
        if (!ticket.session_id) {
          return [];
        }

        const session = store.getSession(ticket.session_id);
        return session ? [session] : [];
      });
      const blockingSession = sessions.find(
        (session) =>
          activeProjectSessionStatuses.has(session.status) ||
          executionRuntime.hasActiveExecution(session.id) ||
          executionRuntime.hasManualTerminal(session.id),
      );
      if (blockingSession) {
        reply.code(409).send({
          error:
            "Stop or finish the project's active execution work before deleting it.",
        });
        return;
      }

      const cleanupWarnings: string[] = [];
      let canRemoveWorktreeRoot = true;
      let deferredWorktreeCleanup = false;

      for (const ticket of tickets) {
        const repository = store.getRepository(ticket.repo);
        const session = ticket.session_id
          ? store.getSession(ticket.session_id)
          : undefined;
        let skipLocalBranchCleanup = false;

        if (session) {
          executionRuntime.cleanupExecutionEnvironment(session.id);
        }

        if (repository && session?.worktree_path) {
          try {
            executionRuntime.closeWorkspaceTerminals(
              session.id,
              "This workspace terminal closed because the project worktree was cleaned up.",
            );
            const worktreeRemoval = removePreparedWorktree(
              repository,
              session.worktree_path,
              project.post_worktree_command,
              ticket.working_branch,
            );
            if (worktreeRemoval.status === "scheduled") {
              canRemoveWorktreeRoot = false;
              deferredWorktreeCleanup = true;
              skipLocalBranchCleanup = true;
            }
          } catch (error) {
            canRemoveWorktreeRoot = false;
            cleanupWarnings.push(
              error instanceof Error
                ? error.message
                : "Unable to remove worktree",
            );
          }
        }

        if (repository && ticket.working_branch && !skipLocalBranchCleanup) {
          try {
            removeLocalBranch(repository, ticket.working_branch);
          } catch (error) {
            cleanupWarnings.push(
              error instanceof Error
                ? error.message
                : "Unable to delete local branch",
            );
          }
        }
      }

      try {
        removeProjectArtifacts(project.slug, {
          includeWorktrees: canRemoveWorktreeRoot,
        });
      } catch (error) {
        cleanupWarnings.push(
          error instanceof Error
            ? error.message
            : "Unable to remove local project artifacts",
        );
      }

      const deletedProject = store.deleteProject(project.id);
      if (!deletedProject) {
        reply.code(404).send({ error: "Project not found" });
        return;
      }

      reply.send(
        makeCommandAck(
          true,
          cleanupWarnings.length === 0
            ? deferredWorktreeCleanup
              ? "Project deleted. Worktree cleanup is continuing in the background."
              : "Project deleted and local artifacts cleaned up"
            : `Project deleted, but cleanup needs attention: ${cleanupWarnings.join(" | ")}`,
          {
            project_id: deletedProject.id,
          },
        ),
      );
    },
  );
};
