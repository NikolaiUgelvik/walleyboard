import {
  clearObservedExecutionActivity,
  upsertObservedExecutionActivity,
} from "../backend-observability.js";
import type { DockerRuntime } from "../docker-runtime.js";

export function updateExecutionActivity(
  dockerRuntime: DockerRuntime,
  input: {
    activityId: string;
    activityType: "draft" | "review" | "session";
    adapter: string;
    lastOutputAt?: string | null;
    startedAt: string;
    ticketId: number | null;
  },
): void {
  const container = dockerRuntime.getSessionContainerInfo(input.activityId);
  upsertObservedExecutionActivity({
    activityId: input.activityId,
    activityType: input.activityType,
    adapter: input.adapter,
    containerId: container?.id ?? null,
    containerName: container?.name ?? null,
    executionMode: "non_pty",
    lastOutputAt: input.lastOutputAt ?? null,
    startedAt: input.startedAt,
    ticketId: input.ticketId,
  });
}

export function clearExecutionActivity(activityId: string): void {
  clearObservedExecutionActivity(activityId);
}
