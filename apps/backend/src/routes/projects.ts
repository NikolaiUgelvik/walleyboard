import type { FastifyPluginAsync, FastifyReply } from "fastify";

import {
  createProjectInputSchema,
  updateProjectInputSchema,
} from "../../../../packages/contracts/src/index.js";

import { makeCommandAck } from "../lib/command-ack.js";
import type { ExecutionRuntime } from "../lib/execution-runtime.js";
import { parseBody } from "../lib/http.js";
import type { Store } from "../lib/store.js";
import { removeProjectArtifacts } from "../lib/ticket-artifacts.js";
import {
  fetchRepositoryBranches,
  removeLocalBranch,
  removePreparedWorktree,
} from "../lib/worktree-service.js";

type ProjectRouteOptions = {
  store: Store;
  executionRuntime: ExecutionRuntime;
};

const activeProjectSessionStatuses = new Set([
  "queued",
  "running",
  "paused_checkpoint",
  "paused_user_control",
  "awaiting_input",
]);

export const projectRoutes: FastifyPluginAsync<ProjectRouteOptions> = async (
  app,
  { store, executionRuntime },
) => {
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

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/repository-branches",
    { preHandler: app.rateLimit() },
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
    { preHandler: app.rateLimit() },
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
