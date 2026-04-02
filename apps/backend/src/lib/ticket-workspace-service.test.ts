import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { EventHub } from "./event-hub.js";
import { TicketWorkspaceService } from "./ticket-workspace-service.js";

function runGit(repoPath: string, args: string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function configureGitIdentity(repoPath: string): void {
  runGit(repoPath, ["config", "user.name", "Test User"]);
  runGit(repoPath, ["config", "user.email", "test@example.com"]);
}

async function canConnect(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

test("TicketWorkspaceService diffs the worktree and publishes live diff updates", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-workspace-"));
  const repoPath = join(tempDir, "repo");
  const worktreePath = join(tempDir, "ticket-worktree");
  const eventHub = new EventHub();
  const workspaceService = new TicketWorkspaceService({
    apiBaseUrl: "http://127.0.0.1:4000",
    eventHub,
  });

  try {
    execFileSync("git", ["init", repoPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    configureGitIdentity(repoPath);

    writeFileSync(join(repoPath, "tracked.txt"), "base\n", "utf8");
    runGit(repoPath, ["add", "tracked.txt"]);
    runGit(repoPath, ["commit", "-m", "initial"]);
    runGit(repoPath, ["branch", "-M", "main"]);

    runGit(repoPath, [
      "worktree",
      "add",
      "-b",
      "ticket-branch",
      worktreePath,
      "main",
    ]);

    writeFileSync(join(worktreePath, "tracked.txt"), "ticket update\n", "utf8");
    writeFileSync(join(worktreePath, "draft.txt"), "untracked draft\n", "utf8");

    const diff = workspaceService.getDiff({
      targetBranch: "main",
      ticketId: 29,
      workingBranch: "ticket-branch",
      worktreePath,
    });

    assert.match(diff.patch, /ticket update/);
    assert.match(diff.patch, /draft\.txt/);
    assert.match(diff.patch, /untracked draft/);

    const workspaceUpdate = await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("Timed out waiting for workspace diff update"));
      }, 5_000);

      const unsubscribe = eventHub.subscribe((event) => {
        if (
          event.event_type === "ticket.workspace.updated" &&
          event.payload.ticket_id === 29 &&
          event.payload.kind === "diff"
        ) {
          clearTimeout(timeout);
          unsubscribe();
          resolve(event);
        }
      });

      writeFileSync(
        join(worktreePath, "tracked.txt"),
        "ticket update 2\n",
        "utf8",
      );
    });

    assert.ok(workspaceUpdate);
  } finally {
    await workspaceService.disposeTicket(29);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("TicketWorkspaceService starts and stops previews for ticket worktrees", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-preview-"));
  const worktreePath = join(tempDir, "preview-app");
  const eventHub = new EventHub();
  const workspaceService = new TicketWorkspaceService({
    apiBaseUrl: "http://127.0.0.1:4000",
    eventHub,
  });

  mkdirSync(worktreePath, { recursive: true });
  writeFileSync(
    join(worktreePath, "package.json"),
    JSON.stringify(
      {
        name: "preview-app",
        private: true,
        type: "module",
        scripts: {
          dev: "node preview-server.js",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    join(worktreePath, "preview-server.js"),
    [
      'import http from "node:http";',
      "",
      'const port = Number.parseInt(process.env.PORT ?? "0", 10);',
      "const server = http.createServer((_request, response) => {",
      '  response.end("preview ok");',
      "});",
      'server.listen(port, "127.0.0.1");',
    ].join("\n"),
    "utf8",
  );

  try {
    const preview = await workspaceService.ensurePreview({
      ticketId: 41,
      worktreePath,
    });

    assert.equal(preview.state, "ready");
    assert.ok(preview.preview_url);

    const previewResponse = await fetch(preview.preview_url);
    assert.equal(await previewResponse.text(), "preview ok");

    const previewPort = Number.parseInt(new URL(preview.preview_url).port, 10);
    assert.equal(await canConnect(previewPort), true);

    await workspaceService.stopPreviewAndWait(41);

    assert.deepEqual(workspaceService.getPreview(41), {
      ticket_id: 41,
      state: "idle",
      preview_url: null,
      backend_url: null,
      started_at: null,
      error: null,
    });
    assert.equal(await canConnect(previewPort), false);
  } finally {
    await workspaceService.disposeTicket(41);
    rmSync(tempDir, { recursive: true, force: true });
  }
});
