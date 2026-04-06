import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
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

test("getClaudeCodeAvailability reports Claude available from the Docker runtime", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-claude-runtime-"));
  const configHomePath = join(tempDir, ".claude");

  mkdirSync(configHomePath, { recursive: true });
  writeFileSync(join(configHomePath, "settings.json"), "{}\n", "utf8");

  try {
    const runtime = new DockerRuntimeManager({
      configHomeResolver: () => configHomePath,
      execFileSyncImpl: ((command: string, args: string[]) => {
        assert.equal(command, "docker");

        if (args[0] === "version") {
          return "29.3.1|29.3.1";
        }

        if (args[0] === "image" && args[1] === "inspect") {
          return "{}";
        }

        if (args[0] === "run") {
          return "/usr/local/bin/claude\n";
        }

        if (args[0] === "network") {
          if (args[1] === "inspect") {
            throw Object.assign(new Error("no such network"), {
              stderr: Buffer.from("Error: No such network"),
            });
          }
          return "";
        }

        throw new Error(`Unexpected docker command: ${args.join(" ")}`);
      }) as never,
      repoRoot: tempDir,
    });

    assert.deepEqual(runtime.getClaudeCodeAvailability(), {
      available: true,
      detected_path: "/usr/local/bin/claude",
      error: null,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("getClaudeCodeAvailability reports a useful error when Claude is unavailable in Docker", () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "walleyboard-claude-runtime-error-"),
  );
  const configHomePath = join(tempDir, ".claude");

  mkdirSync(configHomePath, { recursive: true });
  writeFileSync(join(configHomePath, "settings.json"), "{}\n", "utf8");

  try {
    const runtime = new DockerRuntimeManager({
      configHomeResolver: () => configHomePath,
      execFileSyncImpl: ((command: string, args: string[]) => {
        assert.equal(command, "docker");

        if (args[0] === "version") {
          return "29.3.1|29.3.1";
        }

        if (args[0] === "image" && args[1] === "inspect") {
          return "{}";
        }

        if (args[0] === "run") {
          throw Object.assign(new Error("spawn failed"), {
            stdout: Buffer.from("/usr/local/bin/claude\n"),
            stderr: Buffer.from("permission denied"),
          });
        }

        if (args[0] === "network") {
          if (args[1] === "inspect") {
            throw Object.assign(new Error("no such network"), {
              stderr: Buffer.from("Error: No such network"),
            });
          }
          return "";
        }

        throw new Error(`Unexpected docker command: ${args.join(" ")}`);
      }) as never,
      repoRoot: tempDir,
    });

    assert.deepEqual(runtime.getClaudeCodeAvailability(), {
      available: false,
      detected_path: "/usr/local/bin/claude",
      error: "Claude Code CLI is unavailable: permission denied",
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("getClaudeCodeAvailability reports Claude unavailable when config is missing", () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "walleyboard-claude-runtime-missing-config-"),
  );
  const configHomePath = join(tempDir, ".claude");

  try {
    const runtime = new DockerRuntimeManager({
      configHomeResolver: () => configHomePath,
      execFileSyncImpl: ((command: string, args: string[]) => {
        assert.equal(command, "docker");
        assert.deepEqual(args, [
          "version",
          "--format",
          "{{.Client.Version}}|{{.Server.Version}}",
        ]);
        return "29.3.1|29.3.1";
      }) as never,
      repoRoot: tempDir,
    });

    assert.deepEqual(runtime.getClaudeCodeAvailability(), {
      available: false,
      detected_path: null,
      error: `Claude Code CLI is unavailable: Claude config directory ${configHomePath} does not exist.`,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ensureSessionContainer uses the adapter docker spec for image and config mounts", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-docker-runtime-"));
  const worktreePath = join(tempDir, "workspace");
  const configHomePath = join(tempDir, ".test-agent");
  const walleyBoardHomePath = join(tempDir, ".walleyboard-home");
  const commands: Array<{ command: string; args: string[] }> = [];
  const previousWalleyBoardHome = process.env.WALLEYBOARD_HOME;

  try {
    process.env.WALLEYBOARD_HOME = walleyBoardHomePath;
    const runtime = new DockerRuntimeManager({
      configHomeResolver: () => configHomePath,
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

        if (args[0] === "network") {
          if (args[1] === "inspect") {
            throw Object.assign(new Error("no such network"), {
              stderr: Buffer.from("Error: No such network"),
            });
          }
          return "";
        }

        throw new Error(`Unexpected docker command: ${args.join(" ")}`);
      }) as never,
      gid: 1001,
      repoRoot: tempDir,
      uid: 1000,
    });

    runtime.ensureSessionContainer({
      dockerSpec: {
        imageTag: "example/test-agent:latest",
        dockerfilePath: "apps/backend/docker/codex-runtime.Dockerfile",
        homePath: "/home/test-agent",
        configMountPath: "/home/test-agent/.test-agent",
      },
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
      `type=bind,src=${configHomePath},dst=/home/test-agent/.test-agent`,
      `type=bind,src=${worktreePath},dst=/workspace`,
      `type=bind,src=${walleyBoardHomePath},dst=/walleyboard-home`,
    ]);
  } finally {
    if (previousWalleyBoardHome === undefined) {
      delete process.env.WALLEYBOARD_HOME;
    } else {
      process.env.WALLEYBOARD_HOME = previousWalleyBoardHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ensureSessionContainer rebuilds the runtime image when the Dockerfile is newer than the image", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-docker-runtime-"));
  const worktreePath = join(tempDir, "workspace");
  const configHomePath = join(tempDir, ".test-agent");
  const dockerfilePath = join(
    tempDir,
    "apps/backend/docker/codex-runtime.Dockerfile",
  );
  const walleyBoardHomePath = join(tempDir, ".walleyboard-home");
  const commands: Array<{ command: string; args: string[] }> = [];
  const previousWalleyBoardHome = process.env.WALLEYBOARD_HOME;

  try {
    mkdirSync(join(tempDir, "apps/backend/docker"), { recursive: true });
    writeFileSync(dockerfilePath, "FROM scratch\n", "utf8");
    const newerTimestamp = new Date("2026-04-05T21:20:27.595Z");
    utimesSync(dockerfilePath, newerTimestamp, newerTimestamp);

    process.env.WALLEYBOARD_HOME = walleyBoardHomePath;
    const runtime = new DockerRuntimeManager({
      configHomeResolver: () => configHomePath,
      execFileSyncImpl: ((command: string, args: string[]) => {
        commands.push({ command, args });

        if (args[0] === "version") {
          return "29.3.1|29.3.1";
        }

        if (args[0] === "image" && args[1] === "inspect") {
          return "2026-04-02T15:41:21.70306071+02:00";
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

        if (args[0] === "network") {
          if (args[1] === "inspect") {
            throw Object.assign(new Error("no such network"), {
              stderr: Buffer.from("Error: No such network"),
            });
          }
          return "";
        }

        throw new Error(`Unexpected docker command: ${args.join(" ")}`);
      }) as never,
      repoRoot: tempDir,
    });

    runtime.ensureSessionContainer({
      dockerSpec: {
        imageTag: "example/test-agent:latest",
        dockerfilePath: "apps/backend/docker/codex-runtime.Dockerfile",
        homePath: "/home/test-agent",
        configMountPath: "/home/test-agent/.test-agent",
      },
      sessionId: "session-1",
      projectId: "project-1",
      ticketId: 42,
      worktreePath,
    });

    const buildCommand = commands.find((entry) => entry.args[0] === "build");
    assert.ok(buildCommand);
  } finally {
    if (previousWalleyBoardHome === undefined) {
      delete process.env.WALLEYBOARD_HOME;
    } else {
      process.env.WALLEYBOARD_HOME = previousWalleyBoardHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ensureSessionContainer mounts a config override when provided", () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "walleyboard-docker-config-override-"),
  );
  const worktreePath = join(tempDir, "workspace");
  const configHomePath = join(tempDir, ".test-agent");
  const settingsPath = join(tempDir, "settings.json");
  const walleyBoardHomePath = join(tempDir, ".walleyboard-home");
  const commands: Array<{ command: string; args: string[] }> = [];
  const previousWalleyBoardHome = process.env.WALLEYBOARD_HOME;

  try {
    process.env.WALLEYBOARD_HOME = walleyBoardHomePath;
    const runtime = new DockerRuntimeManager({
      configHomeResolver: () => configHomePath,
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

        if (args[0] === "network") {
          if (args[1] === "inspect") {
            throw Object.assign(new Error("no such network"), {
              stderr: Buffer.from("Error: No such network"),
            });
          }
          return "";
        }

        throw new Error(`Unexpected docker command: ${args.join(" ")}`);
      }) as never,
      gid: 1001,
      repoRoot: tempDir,
      uid: 1000,
    });

    runtime.ensureSessionContainer({
      configFileOverrides: [
        {
          hostPath: settingsPath,
          relativePath: "settings.json",
        },
      ],
      dockerSpec: {
        imageTag: "example/test-agent:latest",
        dockerfilePath: "apps/backend/docker/codex-runtime.Dockerfile",
        homePath: "/home/test-agent",
        configMountPath: "/home/test-agent/.test-agent",
      },
      sessionId: "session-1",
      projectId: "project-1",
      ticketId: 42,
      worktreePath,
    });

    const runCommand = commands.find((entry) => entry.args[0] === "run");
    assert.ok(runCommand);
    const mountArgs = runCommand.args.filter((arg) =>
      arg.startsWith("type=bind,"),
    );
    assert.deepEqual(mountArgs, [
      `type=bind,src=${configHomePath},dst=/home/test-agent/.test-agent`,
      `type=bind,src=${settingsPath},dst=/home/test-agent/.test-agent/settings.json`,
      `type=bind,src=${worktreePath},dst=/workspace`,
      `type=bind,src=${walleyBoardHomePath},dst=/walleyboard-home`,
    ]);
  } finally {
    if (previousWalleyBoardHome === undefined) {
      delete process.env.WALLEYBOARD_HOME;
    } else {
      process.env.WALLEYBOARD_HOME = previousWalleyBoardHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ensureSessionContainer mounts Claude sibling config files when present", () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "walleyboard-docker-claude-config-"),
  );
  const worktreePath = join(tempDir, "workspace");
  const configHomePath = join(tempDir, ".claude");
  const configJsonPath = `${configHomePath}.json`;
  const walleyBoardHomePath = join(tempDir, ".walleyboard-home");
  const commands: Array<{ command: string; args: string[] }> = [];
  const previousWalleyBoardHome = process.env.WALLEYBOARD_HOME;

  try {
    mkdirSync(configHomePath, { recursive: true });
    writeFileSync(join(configHomePath, "settings.json"), "{}\n", "utf8");
    writeFileSync(configJsonPath, '{\n  "theme": "dark"\n}\n', "utf8");
    process.env.WALLEYBOARD_HOME = walleyBoardHomePath;

    const runtime = new DockerRuntimeManager({
      configHomeResolver: () => configHomePath,
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

        if (args[0] === "network") {
          if (args[1] === "inspect") {
            throw Object.assign(new Error("no such network"), {
              stderr: Buffer.from("Error: No such network"),
            });
          }
          return "";
        }

        throw new Error(`Unexpected docker command: ${args.join(" ")}`);
      }) as never,
      gid: 1001,
      repoRoot: tempDir,
      uid: 1000,
    });

    runtime.ensureSessionContainer({
      dockerSpec: {
        imageTag: "example/claude-agent:latest",
        dockerfilePath: "apps/backend/docker/codex-runtime.Dockerfile",
        homePath: "/home/walley",
        configMountPath: "/home/walley/.claude",
      },
      sessionId: "session-1",
      projectId: "project-1",
      ticketId: 42,
      worktreePath,
    });

    const runCommand = commands.find((entry) => entry.args[0] === "run");
    assert.ok(runCommand);
    const mountArgs = runCommand.args.filter((arg) =>
      arg.startsWith("type=bind,"),
    );
    assert.deepEqual(mountArgs, [
      `type=bind,src=${configHomePath},dst=/home/walley/.claude`,
      `type=bind,src=${configJsonPath},dst=/home/walley/.claude.json`,
      `type=bind,src=${worktreePath},dst=/workspace`,
      `type=bind,src=${walleyBoardHomePath},dst=/walleyboard-home`,
    ]);
  } finally {
    if (previousWalleyBoardHome === undefined) {
      delete process.env.WALLEYBOARD_HOME;
    } else {
      process.env.WALLEYBOARD_HOME = previousWalleyBoardHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ensureSessionContainer mounts host-home config paths at both container and host locations", () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "walleyboard-docker-config-alias-"),
  );
  const worktreePath = join(tempDir, "workspace");
  const hostConfigHomePath = join(homedir(), ".codex");
  const settingsPath = join(tempDir, "settings.local.json");
  const walleyBoardHomePath = join(tempDir, ".walleyboard-home");
  const commands: Array<{ command: string; args: string[] }> = [];
  const previousWalleyBoardHome = process.env.WALLEYBOARD_HOME;

  try {
    process.env.WALLEYBOARD_HOME = walleyBoardHomePath;
    const runtime = new DockerRuntimeManager({
      configHomeResolver: () => hostConfigHomePath,
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

        if (args[0] === "network") {
          if (args[1] === "inspect") {
            throw Object.assign(new Error("no such network"), {
              stderr: Buffer.from("Error: No such network"),
            });
          }
          return "";
        }

        throw new Error(`Unexpected docker command: ${args.join(" ")}`);
      }) as never,
      gid: 1001,
      repoRoot: tempDir,
      uid: 1000,
    });

    runtime.ensureSessionContainer({
      configFileOverrides: [
        {
          hostPath: settingsPath,
          relativePath: "settings.local.json",
        },
      ],
      dockerSpec: {
        imageTag: "example/test-agent:latest",
        dockerfilePath: "apps/backend/docker/codex-runtime.Dockerfile",
        homePath: "/home/test-agent",
        configMountPath: "/home/test-agent/.test-agent",
      },
      sessionId: "session-1",
      projectId: "project-1",
      ticketId: 42,
      worktreePath,
    });

    const runCommand = commands.find((entry) => entry.args[0] === "run");
    assert.ok(runCommand);
    const mountArgs = runCommand.args.filter((arg) =>
      arg.startsWith("type=bind,"),
    );
    assert.deepEqual(mountArgs, [
      `type=bind,src=${hostConfigHomePath},dst=/home/test-agent/.test-agent`,
      `type=bind,src=${hostConfigHomePath},dst=${hostConfigHomePath}`,
      `type=bind,src=${settingsPath},dst=/home/test-agent/.test-agent/settings.local.json`,
      `type=bind,src=${settingsPath},dst=${hostConfigHomePath}/settings.local.json`,
      `type=bind,src=${worktreePath},dst=/workspace`,
      `type=bind,src=${walleyBoardHomePath},dst=/walleyboard-home`,
    ]);
  } finally {
    if (previousWalleyBoardHome === undefined) {
      delete process.env.WALLEYBOARD_HOME;
    } else {
      process.env.WALLEYBOARD_HOME = previousWalleyBoardHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("spawnPtyInSession runs docker exec in the workspace", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-docker-pty-"));
  const commands: Array<{ command: string; args: string[] }> = [];
  let spawnedArgs: string[] | null = null;
  const previousWalleyBoardHome = process.env.WALLEYBOARD_HOME;

  try {
    process.env.WALLEYBOARD_HOME = join(tempDir, ".walleyboard-home");
    const runtime = new DockerRuntimeManager({
      configHomeResolver: () => join(tempDir, ".test-agent"),
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

        if (args[0] === "network") {
          if (args[1] === "inspect") {
            throw Object.assign(new Error("no such network"), {
              stderr: Buffer.from("Error: No such network"),
            });
          }
          return "";
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
      dockerSpec: {
        imageTag: "example/test-agent:latest",
        dockerfilePath: "apps/backend/docker/codex-runtime.Dockerfile",
        homePath: "/home/test-agent",
        configMountPath: "/home/test-agent/.test-agent",
      },
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
      "HOME=/home/test-agent",
      "container-id",
      "codex",
      "exec",
    ]);
  } finally {
    if (previousWalleyBoardHome === undefined) {
      delete process.env.WALLEYBOARD_HOME;
    } else {
      process.env.WALLEYBOARD_HOME = previousWalleyBoardHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("spawnProcessInSession wraps unattended commands in script for live flushing", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-docker-process-"));
  let spawnedArgs: string[] | null = null;
  const previousWalleyBoardHome = process.env.WALLEYBOARD_HOME;

  try {
    process.env.WALLEYBOARD_HOME = join(tempDir, ".walleyboard-home");
    const runtime = new DockerRuntimeManager({
      configHomeResolver: () => join(tempDir, ".test-agent"),
      execFileSyncImpl: ((command: string, args: string[]) => {
        assert.equal(command, "docker");

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

        if (args[0] === "network") {
          if (args[1] === "inspect") {
            throw Object.assign(new Error("no such network"), {
              stderr: Buffer.from("Error: No such network"),
            });
          }
          return "";
        }

        throw new Error(`Unexpected docker command: ${args.join(" ")}`);
      }) as never,
      repoRoot: tempDir,
      spawnImpl: ((command: string, args: string[]) => {
        assert.equal(command, "docker");
        spawnedArgs = args;
        return {
          kill() {
            return true;
          },
          on() {
            return this;
          },
          once() {
            return this;
          },
          pid: 321,
          stderr: null,
          stdin: null,
          stdout: null,
        } as never;
      }) as never,
    });

    runtime.ensureSessionContainer({
      dockerSpec: {
        imageTag: "example/test-agent:latest",
        dockerfilePath: "apps/backend/docker/codex-runtime.Dockerfile",
        homePath: "/home/test-agent",
        configMountPath: "/home/test-agent/.test-agent",
      },
      sessionId: "session-1",
      projectId: "project-1",
      ticketId: 42,
      worktreePath: join(tempDir, "workspace"),
    });

    runtime.spawnProcessInSession(
      "session-1",
      "codex",
      [
        "exec",
        "--json",
        "--output-last-message",
        "/walleyboard-home/out.txt",
        "prompt text",
      ],
      {
        cwd: tempDir,
        env: {},
      },
    );

    assert.ok(spawnedArgs);
    const dockerExecArgs = spawnedArgs as string[];
    assert.deepEqual(dockerExecArgs.slice(0, 9), [
      "exec",
      "-i",
      "-w",
      "/workspace",
      "-e",
      "HOME=/home/test-agent",
      "container-id",
      "bash",
      "-lc",
    ]);
    const wrappedCommand = dockerExecArgs[9] ?? "";
    assert.match(wrappedCommand, /^exec script -qefc /);
    assert.match(wrappedCommand, /codex/);
    assert.match(wrappedCommand, /--json/);
    assert.match(wrappedCommand, /--output-last-message/);
    assert.match(wrappedCommand, /\/walleyboard-home\/out\.txt/);
    assert.match(wrappedCommand, /prompt text/);
    assert.match(wrappedCommand, / \/dev\/null$/);
  } finally {
    if (previousWalleyBoardHome === undefined) {
      delete process.env.WALLEYBOARD_HOME;
    } else {
      process.env.WALLEYBOARD_HOME = previousWalleyBoardHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("cleanupStaleContainers removes matching walleyboard containers", () => {
  const commands: Array<{ command: string; args: string[] }> = [];
  const runtime = new DockerRuntimeManager({
    execFileSyncImpl: ((command: string, args: string[]) => {
      commands.push({ command, args });

      if (args[0] === "version") {
        return "29.3.1|29.3.1";
      }

      if (args[0] === "ps") {
        return [
          "container-1|com.walleyboard.session_id=session-1,com.walleyboard.managed=true",
          "container-2|com.walleyboard.session_id=session-2,com.walleyboard.managed=true",
        ].join("\n");
      }

      if (args[0] === "rm") {
        return "";
      }

      throw new Error(`Unexpected docker command: ${args.join(" ")}`);
    }) as never,
    repoRoot: "/tmp/walleyboard",
  });

  runtime.cleanupStaleContainers();

  const rmCommand = commands.find((entry) => entry.args[0] === "rm");
  assert.ok(rmCommand);
  assert.deepEqual(rmCommand.args, ["rm", "-f", "container-1", "container-2"]);
});

test("cleanupStaleContainers preserves containers for active session ids", () => {
  const commands: Array<{ command: string; args: string[] }> = [];
  const runtime = new DockerRuntimeManager({
    execFileSyncImpl: ((command: string, args: string[]) => {
      commands.push({ command, args });

      if (args[0] === "version") {
        return "29.3.1|29.3.1";
      }

      if (args[0] === "ps") {
        return [
          "container-1|com.walleyboard.session_id=session-1,com.walleyboard.managed=true",
          "container-2|com.walleyboard.session_id=session-2,com.walleyboard.managed=true",
        ].join("\n");
      }

      if (args[0] === "rm") {
        return "";
      }

      throw new Error(`Unexpected docker command: ${args.join(" ")}`);
    }) as never,
    repoRoot: "/tmp/walleyboard",
  });

  runtime.cleanupStaleContainers({
    preserveSessionIds: ["session-2"],
  });

  const rmCommand = commands.find((entry) => entry.args[0] === "rm");
  assert.ok(rmCommand);
  assert.deepEqual(rmCommand.args, ["rm", "-f", "container-1"]);
});

test("dispose only cleans up tracked session containers", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-docker-dispose-"));
  const commands: Array<{ command: string; args: string[] }> = [];
  const previousWalleyBoardHome = process.env.WALLEYBOARD_HOME;

  try {
    process.env.WALLEYBOARD_HOME = join(tempDir, ".walleyboard-home");
    const runtime = new DockerRuntimeManager({
      configHomeResolver: () => join(tempDir, ".test-agent"),
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

        if (args[0] === "ps") {
          return "container-1|com.walleyboard.session_id=session-1";
        }

        if (args[0] === "network") {
          if (args[1] === "inspect") {
            throw Object.assign(new Error("no such network"), {
              stderr: Buffer.from("Error: No such network"),
            });
          }
          return "";
        }

        throw new Error(`Unexpected docker command: ${args.join(" ")}`);
      }) as never,
      repoRoot: tempDir,
    });

    runtime.ensureSessionContainer({
      dockerSpec: {
        imageTag: "example/test-agent:latest",
        dockerfilePath: "apps/backend/docker/codex-runtime.Dockerfile",
        homePath: "/home/test-agent",
        configMountPath: "/home/test-agent/.test-agent",
      },
      sessionId: "session-1",
      projectId: "project-1",
      ticketId: 42,
      worktreePath: join(tempDir, "workspace"),
    });

    commands.length = 0;
    runtime.dispose();

    // dispose removes tracked containers then the network
    assert.equal(commands.length, 2);
    assert.equal(commands[0]?.command, "docker");
    assert.equal(commands[0]?.args[0], "rm");
    assert.equal(commands[0]?.args[1], "-f");
    assert.match(
      commands[0]?.args[2] ?? "",
      /^walleyboard-[a-f0-9]{12}-session-1$/,
    );
    assert.equal(commands[1]?.args[0], "network");
    assert.equal(commands[1]?.args[1], "rm");
  } finally {
    if (previousWalleyBoardHome === undefined) {
      delete process.env.WALLEYBOARD_HOME;
    } else {
      process.env.WALLEYBOARD_HOME = previousWalleyBoardHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
