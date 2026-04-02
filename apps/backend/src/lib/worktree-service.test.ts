import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  Project,
  RepositoryConfig,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

import {
  AutomaticMergeRecoveryError,
  fetchRepositoryBranches,
  mergeReviewedBranch,
  prepareWorktree,
  resetPreparedWorktreeImmediately,
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

function createRepositoryConfig(
  path: string,
  targetBranch = "main",
): RepositoryConfig {
  return {
    id: "repo-id",
    project_id: "project-id",
    name: "repo",
    path,
    target_branch: targetBranch,
    setup_hook: null,
    cleanup_hook: null,
    validation_profile: [],
    extra_env_allowlist: [],
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  };
}

function createProject(slug: string): Project {
  return {
    id: "project-id",
    slug,
    name: "Project",
    execution_backend: "host",
    default_target_branch: "main",
    pre_worktree_command: null,
    post_worktree_command: null,
    draft_analysis_model: null,
    draft_analysis_reasoning_effort: null,
    ticket_work_model: null,
    ticket_work_reasoning_effort: null,
    max_concurrent_sessions: 1,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  };
}

function createTicket(targetBranch: string): TicketFrontmatter {
  return {
    id: 38,
    project: "project-id",
    repo: "repo-id",
    artifact_scope_id: "artifact-scope-id",
    status: "ready",
    title: "Handle remote target branches",
    description: "Ticket description",
    ticket_type: "feature",
    acceptance_criteria: ["criterion"],
    working_branch: null,
    target_branch: targetBranch,
    linked_pr: null,
    session_id: null,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  };
}

test("fetchRepositoryBranches returns local and remote branch names", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "orchestrator-repo-branches-"));

  try {
    const remotePath = join(tempDir, "remote.git");
    const repoPath = join(tempDir, "repo");
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

    runGit(repoPath, ["checkout", "-b", "feature/local"]);
    runGit(repoPath, ["checkout", "main"]);

    execFileSync("git", ["clone", remotePath, updaterPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    configureGitIdentity(updaterPath);
    runGit(updaterPath, ["checkout", "-b", "release/1.0"]);
    runGit(updaterPath, ["push", "-u", "origin", "release/1.0"]);

    assert.deepEqual(
      fetchRepositoryBranches(createRepositoryConfig(repoPath)),
      ["feature/local", "main", "origin/main", "origin/release/1.0"],
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("prepareWorktree resolves a remote target branch to a local branch and pulls before creation", () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "orchestrator-prepare-remote-target-"),
  );
  const previousCwd = process.cwd();

  try {
    process.chdir(tempDir);

    const remotePath = join(tempDir, "remote.git");
    const repoPath = join(tempDir, "repo");
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

    const project = createProject("remote-target-project");
    const runtime = prepareWorktree(
      project,
      createRepositoryConfig(repoPath, "origin/main"),
      createTicket("origin/main"),
    );

    assert.ok(
      runtime.logs.some((line) =>
        line.includes(
          "Configured target branch origin/main resolves to local branch main",
        ),
      ),
    );
    assert.ok(
      runtime.logs.some((line) =>
        line.includes("Pulled main from origin/main"),
      ),
    );
    assert.equal(
      runGit(runtime.worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]),
      runtime.workingBranch,
    );
    assert.equal(
      readFileSync(join(runtime.worktreePath, "upstream.txt"), "utf8"),
      "upstream change\n",
    );
  } finally {
    process.chdir(previousCwd);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resetPreparedWorktreeImmediately removes the worktree and branch even when post-worktree cleanup fails", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "orchestrator-reset-worktree-"));
  const previousCwd = process.cwd();

  try {
    process.chdir(tempDir);

    const repoPath = join(tempDir, "repo");
    execFileSync("git", ["init", repoPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    configureGitIdentity(repoPath);

    writeFileSync(join(repoPath, "base.txt"), "base\n", "utf8");
    runGit(repoPath, ["add", "base.txt"]);
    runGit(repoPath, ["commit", "-m", "initial"]);
    runGit(repoPath, ["branch", "-M", "main"]);

    const project = createProject("reset-worktree-project");
    const runtime = prepareWorktree(
      project,
      createRepositoryConfig(repoPath, "main"),
      createTicket("main"),
    );

    configureGitIdentity(runtime.worktreePath);
    writeFileSync(
      join(runtime.worktreePath, "ticket.txt"),
      "ticket work\n",
      "utf8",
    );

    const cleanupLogPath = join(tempDir, "cleanup-log.txt");
    const result = resetPreparedWorktreeImmediately(
      createRepositoryConfig(repoPath, "main"),
      runtime.worktreePath,
      runtime.workingBranch,
      `printf 'cleanup ran\\n' > '${cleanupLogPath}'; exit 7`,
    );

    assert.equal(result.warnings.length, 1);
    const warning = result.warnings[0];
    assert.ok(warning);
    assert.match(warning, /Post-worktree command failed/);
    assert.equal(readFileSync(cleanupLogPath, "utf8"), "cleanup ran\n");
    assert.equal(existsSync(runtime.worktreePath), false);
    assert.equal(
      runGit(repoPath, ["branch", "--list", runtime.workingBranch]),
      "",
    );
  } finally {
    process.chdir(previousCwd);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("prepareWorktree creates a self-contained checkout for docker-backed projects", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "orchestrator-docker-worktree-"));
  const previousCwd = process.cwd();

  try {
    process.chdir(tempDir);

    const repoPath = join(tempDir, "repo");
    execFileSync("git", ["init", repoPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    configureGitIdentity(repoPath);

    writeFileSync(join(repoPath, "base.txt"), "base\n", "utf8");
    runGit(repoPath, ["add", "base.txt"]);
    runGit(repoPath, ["commit", "-m", "initial"]);
    runGit(repoPath, ["branch", "-M", "main"]);

    const project = {
      ...createProject("docker-worktree-project"),
      execution_backend: "docker" as const,
    };
    const runtime = prepareWorktree(
      project,
      createRepositoryConfig(repoPath, "main"),
      createTicket("main"),
    );

    assert.equal(
      lstatSync(join(runtime.worktreePath, ".git")).isDirectory(),
      true,
    );
    assert.equal(
      runGit(runtime.worktreePath, ["config", "--get", "user.name"]),
      "Test User",
    );
    assert.match(
      readFileSync(
        join(runtime.worktreePath, ".git", "info", "exclude"),
        "utf8",
      ),
      /\.orchestrator\//,
    );
  } finally {
    process.chdir(previousCwd);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("prepareWorktree fails clearly and does not create a worktree when the target pull fails", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "orchestrator-prepare-fail-"));
  const previousCwd = process.cwd();

  try {
    process.chdir(tempDir);

    const remotePath = join(tempDir, "remote.git");
    const repoPath = join(tempDir, "repo");
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

    writeFileSync(join(repoPath, "local.txt"), "local change\n", "utf8");
    runGit(repoPath, ["add", "local.txt"]);
    runGit(repoPath, ["commit", "-m", "local change"]);

    execFileSync("git", ["clone", remotePath, updaterPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    configureGitIdentity(updaterPath);
    writeFileSync(join(updaterPath, "remote.txt"), "remote change\n", "utf8");
    runGit(updaterPath, ["add", "remote.txt"]);
    runGit(updaterPath, ["commit", "-m", "remote change"]);
    runGit(updaterPath, ["push", "origin", "main"]);

    const project = createProject("remote-target-failure-project");
    const expectedWorktreePath = join(
      tempDir,
      ".local",
      "worktrees",
      project.slug,
      "ticket-38",
    );

    assert.throws(
      () =>
        prepareWorktree(
          project,
          createRepositoryConfig(repoPath, "origin/main"),
          createTicket("origin/main"),
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(
          error.message,
          /Unable to update target branch main from origin\/main/,
        );
        assert.match(
          error.message,
          /Resolve the repository state and try again/,
        );
        return true;
      },
    );
    assert.equal(existsSync(expectedWorktreePath), false);
  } finally {
    process.chdir(previousCwd);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

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
      result.logs.some((line) => line.includes("Pulled main from origin/main")),
    );
    assert.ok(
      result.logs.some((line) => line.includes("Pushed main to origin/main")),
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

test("mergeReviewedBranch refreshes a remote target ref inside the ticket worktree before merging back", async () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "orchestrator-merge-remote-target-"),
  );

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

    runGit(repoPath, ["checkout", "-b", "sandbox"]);

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
      "origin/main",
    );

    assert.ok(
      result.logs.some((line) =>
        line.includes(
          "Configured target branch origin/main resolves to local branch main",
        ),
      ),
    );
    assert.ok(
      result.logs.some((line) => line.includes("Pulled main from origin/main")),
    );
    assert.ok(
      result.logs.some((line) => line.includes("Pushed main to origin/main")),
    );
    assert.ok(
      result.logs.some((line) =>
        line.includes(`Checked out main in ${repoPath}`),
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
    assert.equal(
      execFileSync(
        "git",
        ["--git-dir", remotePath, "show", "refs/heads/main:ticket.txt"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
      "ticket work\n",
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

test("mergeReviewedBranch invokes the conflict resolver only once across retry attempts", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "orchestrator-merge-retry-"));

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

    let resolverCalls = 0;

    await assert.rejects(
      mergeReviewedBranch(
        createRepositoryConfig(repoPath),
        worktreePath,
        "ticket-branch",
        "main",
        {
          resolveConflicts: () => {
            resolverCalls += 1;
            assert.equal(resolverCalls, 1);
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

            writeFileSync(
              join(repoPath, "story.txt"),
              "main rewrite\n",
              "utf8",
            );
            runGit(repoPath, ["add", "story.txt"]);
            runGit(repoPath, ["commit", "-m", "main rewrite"]);

            return {
              resolved: true,
              logs: ["AI-assisted conflict resolution completed."],
            };
          },
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof AutomaticMergeRecoveryError);
        assert.ok(error.note.includes("existing worktree and branch"));
        assert.ok(
          error.logs.some((line) =>
            line.includes("Refreshing the ticket worktree and retrying"),
          ),
        );
        return true;
      },
    );

    assert.equal(resolverCalls, 1);
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
