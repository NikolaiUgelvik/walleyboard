import type { FastifyContextConfig } from "fastify";

type RouteRateLimitOptions = NonNullable<FastifyContextConfig["rateLimit"]>;

export function withRouteRateLimit(rateLimit: RouteRateLimitOptions = {}): {
  config: {
    rateLimit: RouteRateLimitOptions;
  };
} {
  return {
    config: {
      rateLimit,
    },
  };
}
