import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Fastify from "fastify";
import fastifyRateLimit from "fastify-rate-limit";
import { spawn as spawnPty } from "node-pty";

import type { RepositoryConfig } from "../../../../packages/contracts/src/index.js";
import type { WorkspaceTerminalRuntime } from "../lib/execution-runtime/terminal-runtime.js";
import { SqliteStore } from "../lib/sqlite-store.js";
import {
  handleRepositoryWorkspaceTerminalConnection,
  projectRoutes,
} from "./projects.js";

class FakeTerminalSocket {
  #closed = false;
  #closeListeners = new Set<() => void>();
  #messageListeners = new Set<(payload?: unknown) => void>();
  #messageWaiters = new Set<{
    predicate: (message: Record<string, unknown>) => boolean;
    reject: (error: Error) => void;
    resolve: (message: Record<string, unknown>) => void;
    timeout: NodeJS.Timeout;
  }>();
  readonly messages: Array<Record<string, unknown>> = [];

  close(): void {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    for (const waiter of this.#messageWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(
        new Error("Repository terminal socket closed before the message"),
      );
    }
    this.#messageWaiters.clear();
    for (const listener of this.#closeListeners) {
      listener();
    }
  }

  on(event: "close" | "message", listener: (payload?: unknown) => void): void {
    if (event === "close") {
      this.#closeListeners.add(() => listener());
      return;
    }

    this.#messageListeners.add(listener);
  }

  send(message: string): void {
    const parsed = JSON.parse(message) as Record<string, unknown>;
    this.messages.push(parsed);

    for (const waiter of [...this.#messageWaiters]) {
      if (!waiter.predicate(parsed)) {
        continue;
      }

      clearTimeout(waiter.timeout);
      this.#messageWaiters.delete(waiter);
      waiter.resolve(parsed);
    }
  }

  emitMessage(message: Record<string, unknown>): void {
    const rawMessage = JSON.stringify(message);
    for (const listener of this.#messageListeners) {
      listener(rawMessage);
    }
  }

  async waitForMessage(
    predicate: (message: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    const existing = this.messages.find(predicate);
    if (existing) {
      return existing;
    }

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#messageWaiters.delete(waiter);
        reject(new Error("Timed out waiting for repository terminal message"));
      }, 5_000);
      const waiter = {
        predicate,
        reject,
        resolve,
        timeout,
      };

      this.#messageWaiters.add(waiter);
    });
  }
}

test("project updates reject the Claude adapter when Claude is unavailable", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-project-route-"));

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    const { project } = store.createProject({
      name: "Claude availability project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    const app = Fastify();

    try {
      await app.register(fastifyRateLimit, { global: false });
      await app.register(projectRoutes, {
        assertProjectAgentAdapterSaveAvailable: () => {
          throw new Error(
            "Claude Code CLI is unavailable on this machine: config directory /tmp/.claude does not exist.",
          );
        },
        executionRuntime: {} as never,
        store,
        ticketWorkspaceService: {} as never,
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/projects/${project.id}`,
        payload: {
          agent_adapter: "claude-code",
        },
      });

      assert.equal(response.statusCode, 409);
      assert.deepEqual(response.json(), {
        error:
          "Claude Code CLI is unavailable on this machine: config directory /tmp/.claude does not exist.",
      });
      assert.equal(store.getProject(project.id)?.agent_adapter, "codex");
    } finally {
      await app.close();
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("repository preview runs from the repository path", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-project-preview-"));

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    const repositoryPath = join(tempDir, "repo");
    const { project } = store.createProject({
      name: "Preview project",
      repository: {
        name: "repo",
        path: repositoryPath,
      },
    });
    store.updateProject(project.id, {
      preview_start_command: "npm run dev:web",
    });
    const repository = store.listProjectRepositories(project.id)[0];
    assert.ok(repository, "Expected the project repository to exist");

    let receivedInput: {
      previewStartCommand: string | null;
      repositoryId: string;
      worktreePath: string;
    } | null = null;

    const app = Fastify();

    try {
      await app.register(fastifyRateLimit, { global: false });
      await app.register(projectRoutes, {
        executionRuntime: {} as never,
        store,
        ticketWorkspaceService: {
          async ensureRepositoryPreview(input: {
            previewStartCommand: string | null;
            repositoryId: string;
            worktreePath: string;
          }) {
            receivedInput = input;
            return {
              repository_id: input.repositoryId,
              state: "ready",
              preview_url: "http://127.0.0.1:4100",
              backend_url: null,
              started_at: "2026-04-04T00:00:00.000Z",
              error: null,
            };
          },
          getRepositoryPreview() {
            return {
              repository_id: repository.id,
              state: "idle",
              preview_url: null,
              backend_url: null,
              started_at: null,
              error: null,
            };
          },
          async stopRepositoryPreviewAndWait() {},
        } as never,
      });

      const response = await app.inject({
        method: "POST",
        url: `/projects/${project.id}/repositories/${repository.id}/workspace/preview`,
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(receivedInput, {
        previewStartCommand: "npm run dev:web",
        repositoryId: repository.id,
        worktreePath: repositoryPath,
      });
    } finally {
      await app.close();
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ticket reference search caps results and filters by the typed query", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-project-search-"));

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    const { project, repository } = store.createProject({
      name: "Search project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    for (let index = 1; index <= 25; index += 1) {
      const draft = store.createDraft({
        project_id: project.id,
        title: `Searchable ticket ${index}`,
        description: `Match result ${index}`,
      });

      store.confirmDraft(draft.id, {
        title: draft.title_draft,
        description: draft.description_draft,
        repo_id: repository.id,
        ticket_type: "feature",
        acceptance_criteria: [],
        target_branch: "main",
      });
    }

    const app = Fastify();

    try {
      await app.register(fastifyRateLimit, { global: false });
      await app.register(projectRoutes, {
        executionRuntime: {} as never,
        store,
        ticketWorkspaceService: {} as never,
      });

      const response = await app.inject({
        method: "GET",
        url: `/projects/${project.id}/ticket-references?query=searchable&limit=999`,
      });

      assert.equal(response.statusCode, 200);

      const body = response.json() as {
        ticket_references: Array<{
          status: string;
          ticket_id: number;
          title: string;
        }>;
      };

      assert.equal(body.ticket_references.length, 20);
      assert.match(body.ticket_references[0]?.title ?? "", /Searchable ticket/);
      assert.equal(
        body.ticket_references.every((reference) =>
          reference.title.toLowerCase().includes("searchable"),
        ),
        true,
      );
    } finally {
      await app.close();
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("repository terminal attaches to the repository path", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-project-terminal-"));
  const repository: RepositoryConfig = {
    id: "repository-1",
    project_id: "project-1",
    name: "repo",
    path: tempDir,
    target_branch: "origin/main",
    setup_hook: null,
    cleanup_hook: null,
    validation_profile: [],
    extra_env_allowlist: [],
    created_at: "2026-04-04T00:00:00.000Z",
    updated_at: "2026-04-04T00:00:00.000Z",
  };
  const socket = new FakeTerminalSocket();

  try {
    handleRepositoryWorkspaceTerminalConnection(socket, {
      executionRuntime: {
        startWorkspaceTerminal({
          worktreePath,
        }: {
          sessionId: string;
          worktreePath: string;
        }): WorkspaceTerminalRuntime {
          return {
            exitMessage: null,
            pty: spawnPty("bash", ["--noprofile", "--norc"], {
              cwd: worktreePath,
              env: {
                ...process.env,
                TERM: "xterm-256color",
              },
              cols: 120,
              rows: 32,
              name: "xterm-256color",
            }),
          };
        },
      } as never,
      repository,
    });

    const startedMessage = await socket.waitForMessage(
      (message) => message.type === "terminal.started",
    );

    assert.deepEqual(startedMessage, {
      type: "terminal.started",
      worktree_path: tempDir,
    });

    socket.emitMessage({
      type: "terminal.input",
      data: "exit\r",
    });

    const exitMessage = await socket.waitForMessage(
      (message) => message.type === "terminal.exit",
    );

    assert.equal(exitMessage.type, "terminal.exit");
  } finally {
    socket.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
