import assert from "node:assert/strict";
import test from "node:test";

import type {
  RepositoryConfig,
  ValidationCommand,
} from "../../../../../packages/contracts/src/index.js";
import {
  collectRepositoryValidationCommandUpdates,
  getProjectColorSwatchForegroundColor,
  hasRepositoryValidationCommandChanges,
  mergeRepositoryValidationCommands,
  pickProjectColor,
  projectColorPalette,
  repositoryValidationCommandsEqual,
  resolveProjectAccentVariables,
  validationProfilesEqual,
} from "./shared-utils.js";

function colorChannelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: string): number {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);

  return (
    colorChannelToLinear(red) * 0.2126 +
    colorChannelToLinear(green) * 0.7152 +
    colorChannelToLinear(blue) * 0.0722
  );
}

function contrastRatio(left: string, right: string): number {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

test("pickProjectColor selects an unused swatch when one is available", () => {
  const color = pickProjectColor(
    [
      { color: projectColorPalette[0] },
      { color: projectColorPalette[2] },
      { color: projectColorPalette[4] },
    ],
    () => 0,
  );

  assert.equal(color, projectColorPalette[1]);
});

test("pickProjectColor reuses a swatch when every swatch is already in use", () => {
  const color = pickProjectColor(
    projectColorPalette.map((swatch) => ({ color: swatch })),
    () => 0,
  );

  assert.equal(color, projectColorPalette[0]);
});

test("getProjectColorSwatchForegroundColor keeps every palette swatch legible", () => {
  for (const swatch of projectColorPalette) {
    const foreground = getProjectColorSwatchForegroundColor(swatch);
    assert.ok(
      contrastRatio(swatch, foreground) >= 3,
      `Expected ${swatch} to keep at least 3:1 contrast with ${foreground}`,
    );
  }
});

test("resolveProjectAccentVariables preserves the chosen swatch and its readable contrast color", () => {
  const accent = resolveProjectAccentVariables("#F97316");

  assert.deepEqual(accent, {
    "--selected-project-color": "#F97316",
    "--selected-project-contrast":
      getProjectColorSwatchForegroundColor("#F97316"),
  });
});

function makeValidationCommand(
  overrides: Partial<ValidationCommand> = {},
): ValidationCommand {
  return {
    id: "cmd-1",
    label: "Type check",
    command: "npm run typecheck",
    working_directory: "/workspace",
    timeout_ms: 300_000,
    required_for_review: false,
    shell: true,
    ...overrides,
  };
}

function makeRepository(
  overrides: Partial<RepositoryConfig> = {},
): RepositoryConfig {
  return {
    id: "repo-1",
    project_id: "project-1",
    name: "my-repo",
    path: "/workspace",
    target_branch: "main",
    setup_hook: null,
    cleanup_hook: null,
    validation_profile: [],
    extra_env_allowlist: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("validationProfilesEqual returns true for identical profiles", () => {
  const a = [makeValidationCommand()];
  const b = [makeValidationCommand()];
  assert.equal(validationProfilesEqual(a, b), true);
});

test("validationProfilesEqual returns true for empty profiles", () => {
  assert.equal(validationProfilesEqual([], []), true);
});

test("validationProfilesEqual detects label change", () => {
  const a = [makeValidationCommand()];
  const b = [makeValidationCommand({ label: "Lint" })];
  assert.equal(validationProfilesEqual(a, b), false);
});

test("validationProfilesEqual detects added command", () => {
  const a = [makeValidationCommand()];
  const b = [makeValidationCommand(), makeValidationCommand({ id: "cmd-2" })];
  assert.equal(validationProfilesEqual(a, b), false);
});

test("validationProfilesEqual detects removed command", () => {
  const a = [makeValidationCommand(), makeValidationCommand({ id: "cmd-2" })];
  const b = [makeValidationCommand()];
  assert.equal(validationProfilesEqual(a, b), false);
});

test("validationProfilesEqual detects timeout_ms change", () => {
  const a = [makeValidationCommand()];
  const b = [makeValidationCommand({ timeout_ms: 60_000 })];
  assert.equal(validationProfilesEqual(a, b), false);
});

test("validationProfilesEqual detects required_for_review change", () => {
  const a = [makeValidationCommand()];
  const b = [makeValidationCommand({ required_for_review: true })];
  assert.equal(validationProfilesEqual(a, b), false);
});

test("hasRepositoryValidationCommandChanges returns false when nothing is edited", () => {
  const cmd = makeValidationCommand();
  const repo = makeRepository({ validation_profile: [cmd] });
  assert.equal(
    hasRepositoryValidationCommandChanges({
      repositories: [repo],
      repositoryValidationCommands: { [repo.id]: [cmd] },
    }),
    false,
  );
});

test("hasRepositoryValidationCommandChanges returns false when repo has no entry in edited map", () => {
  const repo = makeRepository({
    validation_profile: [makeValidationCommand()],
  });
  assert.equal(
    hasRepositoryValidationCommandChanges({
      repositories: [repo],
      repositoryValidationCommands: {},
    }),
    false,
  );
});

test("hasRepositoryValidationCommandChanges detects a single-field edit", () => {
  const original = makeValidationCommand();
  const edited = makeValidationCommand({ command: "npm run lint" });
  const repo = makeRepository({ validation_profile: [original] });
  assert.equal(
    hasRepositoryValidationCommandChanges({
      repositories: [repo],
      repositoryValidationCommands: { [repo.id]: [edited] },
    }),
    true,
  );
});

test("hasRepositoryValidationCommandChanges detects added command", () => {
  const original = makeValidationCommand();
  const repo = makeRepository({ validation_profile: [original] });
  assert.equal(
    hasRepositoryValidationCommandChanges({
      repositories: [repo],
      repositoryValidationCommands: {
        [repo.id]: [original, makeValidationCommand({ id: "cmd-2" })],
      },
    }),
    true,
  );
});

test("hasRepositoryValidationCommandChanges detects removed command", () => {
  const repo = makeRepository({
    validation_profile: [
      makeValidationCommand(),
      makeValidationCommand({ id: "cmd-2" }),
    ],
  });
  assert.equal(
    hasRepositoryValidationCommandChanges({
      repositories: [repo],
      repositoryValidationCommands: { [repo.id]: [makeValidationCommand()] },
    }),
    true,
  );
});

test("collectRepositoryValidationCommandUpdates returns empty when nothing changed", () => {
  const cmd = makeValidationCommand();
  const repo = makeRepository({ validation_profile: [cmd] });
  assert.deepEqual(
    collectRepositoryValidationCommandUpdates({
      repositories: [repo],
      repositoryValidationCommands: { [repo.id]: [cmd] },
    }),
    [],
  );
});

test("collectRepositoryValidationCommandUpdates returns empty when repo has no entry", () => {
  const repo = makeRepository({
    validation_profile: [makeValidationCommand()],
  });
  assert.deepEqual(
    collectRepositoryValidationCommandUpdates({
      repositories: [repo],
      repositoryValidationCommands: {},
    }),
    [],
  );
});

test("collectRepositoryValidationCommandUpdates includes changed repository", () => {
  const original = makeValidationCommand();
  const edited = makeValidationCommand({ label: "Lint" });
  const repo = makeRepository({ validation_profile: [original] });
  const result = collectRepositoryValidationCommandUpdates({
    repositories: [repo],
    repositoryValidationCommands: { [repo.id]: [edited] },
  });
  assert.equal(result.length, 1);
  const update = result[0];
  assert.ok(update);
  assert.equal(update.repositoryId, repo.id);
  assert.deepEqual(update.validationProfile, [edited]);
});

test("collectRepositoryValidationCommandUpdates handles add-then-remove returning to original", () => {
  const cmd = makeValidationCommand();
  const repo = makeRepository({ validation_profile: [cmd] });
  assert.deepEqual(
    collectRepositoryValidationCommandUpdates({
      repositories: [repo],
      repositoryValidationCommands: { [repo.id]: [cmd] },
    }),
    [],
  );
});

test("mergeRepositoryValidationCommands preserves local edits for existing repositories", () => {
  const original = makeValidationCommand();
  const edited = makeValidationCommand({ label: "Lint" });
  const repo = makeRepository({ validation_profile: [original] });
  const result = mergeRepositoryValidationCommands({ [repo.id]: [edited] }, [
    repo,
  ]);
  assert.deepEqual(result[repo.id], [edited]);
});

test("mergeRepositoryValidationCommands uses server data for new repositories", () => {
  const cmd = makeValidationCommand();
  const existingRepo = makeRepository({ validation_profile: [cmd] });
  const newRepo = makeRepository({
    id: "repo-2",
    validation_profile: [makeValidationCommand({ id: "cmd-new" })],
  });
  const result = mergeRepositoryValidationCommands(
    { [existingRepo.id]: [makeValidationCommand({ label: "User edit" })] },
    [existingRepo, newRepo],
  );
  assert.deepEqual(result[newRepo.id], newRepo.validation_profile);
});

test("mergeRepositoryValidationCommands drops removed repositories from result", () => {
  const removedRepo = makeRepository({ id: "repo-removed" });
  const activeRepo = makeRepository({ id: "repo-active" });
  const result = mergeRepositoryValidationCommands(
    {
      [removedRepo.id]: [makeValidationCommand()],
      [activeRepo.id]: [makeValidationCommand()],
    },
    [activeRepo],
  );
  assert.equal(result[removedRepo.id], undefined);
  assert.ok(result[activeRepo.id]);
});

test("repositoryValidationCommandsEqual returns true for identical maps", () => {
  const cmd = makeValidationCommand();
  assert.equal(
    repositoryValidationCommandsEqual({ "repo-1": [cmd] }, { "repo-1": [cmd] }),
    true,
  );
});

test("repositoryValidationCommandsEqual returns false when values differ", () => {
  assert.equal(
    repositoryValidationCommandsEqual(
      { "repo-1": [makeValidationCommand()] },
      { "repo-1": [makeValidationCommand({ label: "Changed" })] },
    ),
    false,
  );
});

test("repositoryValidationCommandsEqual returns false for different keys", () => {
  const cmd = makeValidationCommand();
  assert.equal(
    repositoryValidationCommandsEqual({ "repo-1": [cmd] }, { "repo-2": [cmd] }),
    false,
  );
});
