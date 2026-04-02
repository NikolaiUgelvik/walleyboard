import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DockerRuntimeManager } from "./docker-runtime.js";

test("getHealth reports Docker availability from docker version", () => {
  const runtime = new DockerRuntimeManager({
    execFileSyncImpl: ((command: string, args: string[]) => {
      assert.equal(command, "docker");
      assert.deepEqual(args, [
        "version",
        "--format",
        "{{.Client.Version}}|{{.Server.Version}}",
      ]);
      return "29.3.1|29.3.1";
    }) as never,
  });

  assert.deepEqual(runtime.getHealth(), {
    installed: true,
    available: true,
    client_version: "29.3.1",
    server_version: "29.3.1",
    error: null,
  });
});

test("ensureSessionContainer builds the image and binds only codex config and workspace", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "orchestrator-docker-runtime-"));
  const worktreePath = join(tempDir, "workspace");
  const codexHomePath = join(tempDir, ".codex");
  const commands: Array<{ command: string; args: string[] }> = [];

  try {
    const runtime = new DockerRuntimeManager({
      codexHomePath,
      execFileSyncImpl: ((command: string, args: string[]) => {
        commands.push({ command, args });

        if (args[0] === "version") {
          return "29.3.1|29.3.1";
        }

        if (args[0] === "image" && args[1] === "inspect") {
          throw Object.assign(new Error("missing image"), {
            stderr: Buffer.from("Error: No such image"),
          });
        }

        if (args[0] === "build") {
          return "built-image";
        }

        if (args[0] === "rm") {
          return "";
        }

        if (args[0] === "run") {
          return "container-id";
        }

        throw new Error(`Unexpected docker command: ${args.join(" ")}`);
      }) as never,
      gid: 1001,
      repoRoot: tempDir,
      uid: 1000,
    });

    runtime.ensureSessionContainer({
      sessionId: "session-1",
      projectId: "project-1",
      ticketId: 42,
      worktreePath,
    });

    const buildCommand = commands.find((entry) => entry.args[0] === "build");
    assert.ok(buildCommand);

    const runCommand = commands.find((entry) => entry.args[0] === "run");
    assert.ok(runCommand);
    const mountArgs = runCommand.args.filter((arg) =>
      arg.startsWith("type=bind,"),
    );
    assert.deepEqual(mountArgs, [
      `type=bind,src=${codexHomePath},dst=/home/codex/.codex`,
      `type=bind,src=${worktreePath},dst=/workspace`,
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("spawnPtyInSession runs docker exec in the workspace", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "orchestrator-docker-pty-"));
  const commands: Array<{ command: string; args: string[] }> = [];
  let spawnedArgs: string[] | null = null;

  try {
    const runtime = new DockerRuntimeManager({
      codexHomePath: join(tempDir, ".codex"),
      execFileSyncImpl: ((command: string, args: string[]) => {
        commands.push({ command, args });

        if (args[0] === "version") {
          return "29.3.1|29.3.1";
        }

        if (args[0] === "image" && args[1] === "inspect") {
          return "{}";
        }

        if (args[0] === "rm") {
          return "";
        }

        if (args[0] === "run") {
          return "container-id";
        }

        throw new Error(`Unexpected docker command: ${args.join(" ")}`);
      }) as never,
      repoRoot: tempDir,
      spawnPtyImpl: ((command: string, args: string[]) => {
        assert.equal(command, "docker");
        spawnedArgs = args;
        return {
          kill() {},
          onData() {},
          onExit() {},
          pid: 321,
          process: "docker",
          resize() {},
          write() {},
        } as never;
      }) as never,
    });

    runtime.ensureSessionContainer({
      sessionId: "session-1",
      projectId: "project-1",
      ticketId: 42,
      worktreePath: join(tempDir, "workspace"),
    });

    runtime.spawnPtyInSession("session-1", "codex", ["exec"], {
      cols: 120,
      rows: 32,
      cwd: tempDir,
      env: {},
      name: "xterm-256color",
    });

    assert.deepEqual(spawnedArgs, [
      "exec",
      "-i",
      "-t",
      "-w",
      "/workspace",
      "-e",
      "HOME=/home/codex",
      "container-id",
      "codex",
      "exec",
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("cleanupStaleContainers removes matching orchestrator containers", () => {
  const commands: Array<{ command: string; args: string[] }> = [];
  const runtime = new DockerRuntimeManager({
    execFileSyncImpl: ((command: string, args: string[]) => {
      commands.push({ command, args });

      if (args[0] === "version") {
        return "29.3.1|29.3.1";
      }

      if (args[0] === "ps") {
        return "container-1\ncontainer-2";
      }

      if (args[0] === "rm") {
        return "";
      }

      throw new Error(`Unexpected docker command: ${args.join(" ")}`);
    }) as never,
    repoRoot: "/tmp/orchestrator",
  });

  runtime.cleanupStaleContainers();

  const rmCommand = commands.find((entry) => entry.args[0] === "rm");
  assert.ok(rmCommand);
  assert.deepEqual(rmCommand.args, ["rm", "-f", "container-1", "container-2"]);
});
