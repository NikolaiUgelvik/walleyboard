import type { FastifyPluginAsync } from "fastify";

import { createProjectInputSchema } from "@orchestrator/contracts";

import { makeCommandAck } from "../lib/command-ack.js";
import { parseBody } from "../lib/http.js";
import type { EventHub } from "../lib/event-hub.js";
import { MemoryStore } from "../lib/memory-store.js";

type ProjectRouteOptions = {
  eventHub: EventHub;
  store: MemoryStore;
};

export const projectRoutes: FastifyPluginAsync<ProjectRouteOptions> = async (
  app,
  { store }
) => {
  app.get("/projects", async () => ({
    projects: store.listProjects()
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
    }
  );

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/repositories",
    async (request) => ({
      repositories: store.listProjectRepositories(request.params.projectId)
    })
  );

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/tickets",
    async (request) => ({
      tickets: store.listProjectTickets(request.params.projectId)
    })
  );

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId/drafts",
    async (request) => ({
      drafts: store.listProjectDrafts(request.params.projectId)
    })
  );

  app.post("/projects", async (request, reply) => {
    const input = parseBody(reply, createProjectInputSchema, request.body);
    if (!input) {
      return;
    }

    const { project, repository } = store.createProject(input);

    reply.code(201).send(
      makeCommandAck(true, "Project created", {
        project_id: project.id,
        repo_id: repository.id
      })
    );
  });
};
