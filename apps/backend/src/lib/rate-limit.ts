import type { FastifyInstance } from "fastify";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTimeWindow(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export function globalRateLimitOptions() {
  return {
    hook: "preHandler" as const,
    max: parsePositiveInt(process.env.RATE_LIMIT_MAX, 6000),
    timeWindow: parseTimeWindow(process.env.RATE_LIMIT_TIME_WINDOW, "1 minute"),
    enableDraftSpec: true,
  };
}

export function fileRouteRateLimit(app: FastifyInstance) {
  return app.rateLimit({
    max: parsePositiveInt(process.env.FILE_ROUTE_RATE_LIMIT_MAX, 600),
    timeWindow: parseTimeWindow(
      process.env.FILE_ROUTE_RATE_LIMIT_TIME_WINDOW,
      "1 minute",
    ),
  });
}

export function repositoryRouteRateLimit(app: FastifyInstance) {
  return app.rateLimit({
    max: parsePositiveInt(process.env.REPOSITORY_ROUTE_RATE_LIMIT_MAX, 300),
    timeWindow: parseTimeWindow(
      process.env.REPOSITORY_ROUTE_RATE_LIMIT_TIME_WINDOW,
      "1 minute",
    ),
  });
}

export function commandRouteRateLimit(app: FastifyInstance) {
  return app.rateLimit({
    max: parsePositiveInt(process.env.COMMAND_ROUTE_RATE_LIMIT_MAX, 60),
    timeWindow: parseTimeWindow(
      process.env.COMMAND_ROUTE_RATE_LIMIT_TIME_WINDOW,
      "1 minute",
    ),
  });
}
