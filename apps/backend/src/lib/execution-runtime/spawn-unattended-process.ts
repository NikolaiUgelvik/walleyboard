import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { PreparedAgentRun } from "../agent-adapters/types.js";
import type { DockerRuntime } from "../docker-runtime.js";
import { closeProcessStdin } from "./helpers.js";

export function spawnUnattendedProcessInSession(input: {
  cwd: string;
  dockerRuntime: DockerRuntime;
  env: Record<string, string>;
  run: Pick<PreparedAgentRun, "args" | "command">;
  sessionId: string;
}): ChildProcessWithoutNullStreams {
  const child = input.dockerRuntime.spawnProcessInSession(
    input.sessionId,
    input.run.command,
    input.run.args,
    {
      cwd: input.cwd,
      env: input.env,
    },
  );
  closeProcessStdin(child);
  return child;
}
