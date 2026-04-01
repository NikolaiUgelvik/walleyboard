import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RepositoryConfig } from "../../../../packages/contracts/src/index.js";

import {
  AutomaticMergeRecoveryError,
  mergeReviewedBranch,
} from "./worktree-service.js";

function runGit(
  repoPath: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
): string {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function configureGitIdentity(repoPath: string): void {
  runGit(repoPath, ["config", "user.name", "Test User"]);
  runGit(repoPath, ["config", "user.email", "test@example.com"]);
}

function createRepositoryConfig(path: string): RepositoryConfig {
  return {
    id: "repo-id",
    project_id: "project-id",
    name: "repo",
    path,
    target_branch: "main",
    setup_hook: null,
    cleanup_hook: null,
    validation_profile: [],
    extra_env_allowlist: [],
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  };
}

test("mergeReviewedBranch refreshes the target branch before rebasing and merging", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "orchestrator-merge-refresh-"));

  try {
    const remotePath = join(tempDir, "remote.git");
    const repoPath = join(tempDir, "repo");
    const worktreePath = join(tempDir, "ticket-worktree");
    const updaterPath = join(tempDir, "updater");

    execFileSync("git", ["init", "--bare", remotePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    execFileSync("git", ["clone", remotePath, repoPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    configureGitIdentity(repoPath);

    writeFileSync(join(repoPath, "base.txt"), "base\n", "utf8");
    runGit(repoPath, ["add", "base.txt"]);
    runGit(repoPath, ["commit", "-m", "initial"]);
    runGit(repoPath, ["branch", "-M", "main"]);
    runGit(repoPath, ["push", "-u", "origin", "main"]);
    execFileSync(
      "git",
      ["--git-dir", remotePath, "symbolic-ref", "HEAD", "refs/heads/main"],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    runGit(repoPath, [
      "worktree",
      "add",
      "-b",
      "ticket-branch",
      worktreePath,
      "main",
    ]);
    configureGitIdentity(worktreePath);
    writeFileSync(join(worktreePath, "ticket.txt"), "ticket work\n", "utf8");
    runGit(worktreePath, ["add", "ticket.txt"]);
    runGit(worktreePath, ["commit", "-m", "ticket change"]);

    execFileSync("git", ["clone", remotePath, updaterPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    configureGitIdentity(updaterPath);
    writeFileSync(
      join(updaterPath, "upstream.txt"),
      "upstream change\n",
      "utf8",
    );
    runGit(updaterPath, ["add", "upstream.txt"]);
    runGit(updaterPath, ["commit", "-m", "upstream change"]);
    runGit(updaterPath, ["push", "origin", "main"]);

    const result = await mergeReviewedBranch(
      createRepositoryConfig(repoPath),
      worktreePath,
      "ticket-branch",
      "main",
    );

    assert.ok(
      result.logs.some((line) =>
        line.includes("Refreshed main from origin/main"),
      ),
    );
    assert.equal(
      runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]),
      "main",
    );
    assert.equal(
      readFileSync(join(repoPath, "upstream.txt"), "utf8"),
      "upstream change\n",
    );
    assert.equal(
      readFileSync(join(repoPath, "ticket.txt"), "utf8"),
      "ticket work\n",
    );
    assert.equal(
      runGit(repoPath, ["log", "--format=%s", "-1"]),
      "ticket change",
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("mergeReviewedBranch uses the conflict resolver and completes the rebase before merging", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "orchestrator-merge-conflict-"));

  try {
    const repoPath = join(tempDir, "repo");
    const worktreePath = join(tempDir, "ticket-worktree");
    execFileSync("git", ["init", repoPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    configureGitIdentity(repoPath);

    writeFileSync(join(repoPath, "story.txt"), "base\n", "utf8");
    runGit(repoPath, ["add", "story.txt"]);
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
    configureGitIdentity(worktreePath);
    writeFileSync(join(worktreePath, "story.txt"), "ticket change\n", "utf8");
    runGit(worktreePath, ["add", "story.txt"]);
    runGit(worktreePath, ["commit", "-m", "ticket change"]);

    writeFileSync(join(repoPath, "story.txt"), "main change\n", "utf8");
    runGit(repoPath, ["add", "story.txt"]);
    runGit(repoPath, ["commit", "-m", "main change"]);

    const result = await mergeReviewedBranch(
      createRepositoryConfig(repoPath),
      worktreePath,
      "ticket-branch",
      "main",
      {
        resolveConflicts: ({ stage, conflictedFiles }) => {
          assert.equal(stage, "rebase");
          assert.deepEqual(conflictedFiles, ["story.txt"]);
          writeFileSync(
            join(worktreePath, "story.txt"),
            "main change\nticket change\n",
            "utf8",
          );
          runGit(worktreePath, ["add", "story.txt"]);
          runGit(
            worktreePath,
            ["-c", "core.editor=true", "rebase", "--continue"],
            { GIT_EDITOR: "true" },
          );
          return {
            resolved: true,
            logs: ["AI-assisted conflict resolution completed."],
          };
        },
      },
    );

    assert.ok(
      result.logs.some((line) =>
        line.includes("AI-assisted conflict resolution completed."),
      ),
    );
    assert.equal(
      readFileSync(join(repoPath, "story.txt"), "utf8"),
      "main change\nticket change\n",
    );
    assert.equal(
      runGit(repoPath, ["log", "--format=%s", "-1"]),
      "ticket change",
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("mergeReviewedBranch surfaces an automatic-recovery error when conflicts remain unresolved", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "orchestrator-merge-unresolved-"));

  try {
    const repoPath = join(tempDir, "repo");
    const worktreePath = join(tempDir, "ticket-worktree");
    execFileSync("git", ["init", repoPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    configureGitIdentity(repoPath);

    writeFileSync(join(repoPath, "story.txt"), "base\n", "utf8");
    runGit(repoPath, ["add", "story.txt"]);
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
    configureGitIdentity(worktreePath);
    writeFileSync(join(worktreePath, "story.txt"), "ticket change\n", "utf8");
    runGit(worktreePath, ["add", "story.txt"]);
    runGit(worktreePath, ["commit", "-m", "ticket change"]);

    writeFileSync(join(repoPath, "story.txt"), "main change\n", "utf8");
    runGit(repoPath, ["add", "story.txt"]);
    runGit(repoPath, ["commit", "-m", "main change"]);

    await assert.rejects(
      mergeReviewedBranch(
        createRepositoryConfig(repoPath),
        worktreePath,
        "ticket-branch",
        "main",
        {
          resolveConflicts: () => ({
            resolved: false,
            logs: ["AI-assisted conflict resolution could not finish safely."],
            note: "Conflict note for the user.",
          }),
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof AutomaticMergeRecoveryError);
        assert.equal(error.note, "Conflict note for the user.");
        assert.ok(
          error.logs.some((line) =>
            line.includes(
              "AI-assisted conflict resolution could not finish safely.",
            ),
          ),
        );
        return true;
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
