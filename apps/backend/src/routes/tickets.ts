import type { FastifyPluginAsync } from "fastify";

import { registerTicketExecutionRoutes } from "./tickets/execution-routes.js";
import { registerTicketLifecycleRoutes } from "./tickets/lifecycle-routes.js";
import { registerTicketReadWorkspaceRoutes } from "./tickets/read-workspace-routes.js";
import { registerTicketReviewRoutes } from "./tickets/review-routes.js";
import {
  createTicketRouteDependencies,
  type TicketRouteOptions,
} from "./tickets/shared.js";

export const ticketRoutes: FastifyPluginAsync<TicketRouteOptions> = async (
  app,
  options,
) => {
  const dependencies = createTicketRouteDependencies(options);

  registerTicketReadWorkspaceRoutes(app, dependencies);
  registerTicketExecutionRoutes(app, dependencies);
  registerTicketLifecycleRoutes(app, dependencies);
  registerTicketReviewRoutes(app, dependencies);
};
