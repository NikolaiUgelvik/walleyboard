import { existsSync, statSync } from "node:fs";

import type {
  DraftTicketState,
  Project,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

import type {
  DraftPersistence,
  ProjectPersistence,
  TicketPersistence,
} from "./store.js";
import {
  buildTicketArtifactFilePath,
  buildTicketArtifactScopePath,
  listTicketArtifactScopeFiles,
  listTicketArtifactScopes,
  removeTicketArtifactFile,
  removeTicketArtifactScope,
} from "./ticket-artifacts.js";

const markdownImagePattern = /!\[[^\]]*]\(([^)\s]+)\)/g;

export type DraftArtifactCleanupPersistence = ProjectPersistence &
  DraftPersistence &
  TicketPersistence;

export type DraftArtifactCleanupResult = {
  removedFiles: string[];
  removedScopes: string[];
};

function normalizeHref(href: string): string {
  try {
    return new URL(href, "http://walleyboard.local").pathname;
  } catch {
    return href;
  }
}

function collectArtifactReferencesFromMarkdown(input: {
  artifactReferences: Map<string, Set<string>>;
  markdown: string;
  projectId: string;
}): void {
  for (const match of input.markdown.matchAll(markdownImagePattern)) {
    const href = match[1];
    if (typeof href !== "string") {
      continue;
    }

    const normalizedHref = normalizeHref(href);
    const prefix = `/projects/${input.projectId}/draft-artifacts/`;
    if (!normalizedHref.startsWith(prefix)) {
      continue;
    }

    const remainder = normalizedHref.slice(prefix.length);
    const slashIndex = remainder.indexOf("/");
    if (slashIndex <= 0 || slashIndex === remainder.length - 1) {
      continue;
    }

    const artifactScopeId = remainder.slice(0, slashIndex);
    const filename = remainder.slice(slashIndex + 1);
    if (filename.length === 0) {
      continue;
    }

    let filenames = input.artifactReferences.get(artifactScopeId);
    if (!filenames) {
      filenames = new Set<string>();
      input.artifactReferences.set(artifactScopeId, filenames);
    }
    filenames.add(filename);
  }
}

function collectProjectArtifactReferences(
  project: Project,
  drafts: DraftTicketState[],
  tickets: TicketFrontmatter[],
): Map<string, Set<string>> {
  const artifactReferences = new Map<string, Set<string>>();

  for (const draft of drafts) {
    collectArtifactReferencesFromMarkdown({
      artifactReferences,
      markdown: draft.description_draft,
      projectId: project.id,
    });
    for (const criterion of draft.proposed_acceptance_criteria) {
      collectArtifactReferencesFromMarkdown({
        artifactReferences,
        markdown: criterion,
        projectId: project.id,
      });
    }
  }

  for (const ticket of tickets) {
    collectArtifactReferencesFromMarkdown({
      artifactReferences,
      markdown: ticket.description,
      projectId: project.id,
    });
    for (const criterion of ticket.acceptance_criteria) {
      collectArtifactReferencesFromMarkdown({
        artifactReferences,
        markdown: criterion,
        projectId: project.id,
      });
    }
  }

  return artifactReferences;
}

function isStaleOrphanScope(
  projectSlug: string,
  artifactScopeId: string,
  orphanScopeGraceMs: number,
): boolean {
  if (orphanScopeGraceMs <= 0) {
    return true;
  }

  const scopePath = buildTicketArtifactScopePath(projectSlug, artifactScopeId);
  if (!existsSync(scopePath)) {
    return false;
  }

  const ageMs = Date.now() - statSync(scopePath).mtimeMs;
  return ageMs >= orphanScopeGraceMs;
}

function isStaleArtifactFile(
  projectSlug: string,
  artifactScopeId: string,
  filename: string,
  orphanScopeGraceMs: number,
): boolean {
  if (orphanScopeGraceMs <= 0) {
    return true;
  }

  const filePath = buildTicketArtifactFilePath(
    projectSlug,
    artifactScopeId,
    filename,
  );
  if (!existsSync(filePath)) {
    return false;
  }

  const ageMs = Date.now() - statSync(filePath).mtimeMs;
  return ageMs >= orphanScopeGraceMs;
}

export function cleanupProjectDraftArtifacts(input: {
  orphanScopeGraceMs: number;
  project: Project;
  store: DraftArtifactCleanupPersistence;
}): DraftArtifactCleanupResult {
  const drafts = input.store.listProjectDrafts(input.project.id);
  const tickets = input.store.listProjectTickets(input.project.id, {
    includeArchived: true,
  });
  const referencedArtifacts = collectProjectArtifactReferences(
    input.project,
    drafts,
    tickets,
  );

  const removedFiles: string[] = [];
  const removedScopes: string[] = [];

  for (const artifactScopeId of listTicketArtifactScopes(input.project.slug)) {
    const referencedFiles = referencedArtifacts.get(artifactScopeId);

    if (!referencedFiles || referencedFiles.size === 0) {
      if (
        isStaleOrphanScope(
          input.project.slug,
          artifactScopeId,
          input.orphanScopeGraceMs,
        )
      ) {
        const removedPath = removeTicketArtifactScope(
          input.project.slug,
          artifactScopeId,
        );
        if (removedPath) {
          removedScopes.push(removedPath);
        }
      }
      continue;
    }

    for (const filename of listTicketArtifactScopeFiles(
      input.project.slug,
      artifactScopeId,
    )) {
      if (
        referencedFiles.has(filename) ||
        !isStaleArtifactFile(
          input.project.slug,
          artifactScopeId,
          filename,
          input.orphanScopeGraceMs,
        )
      ) {
        continue;
      }

      const removedPath = removeTicketArtifactFile(
        input.project.slug,
        artifactScopeId,
        filename,
      );
      if (removedPath) {
        removedFiles.push(removedPath);
      }
    }

    if (
      listTicketArtifactScopeFiles(input.project.slug, artifactScopeId)
        .length === 0
    ) {
      const removedPath = removeTicketArtifactScope(
        input.project.slug,
        artifactScopeId,
      );
      if (removedPath) {
        removedScopes.push(removedPath);
      }
    }
  }

  return {
    removedFiles,
    removedScopes,
  };
}

export function cleanupAllDraftArtifacts(input: {
  orphanScopeGraceMs: number;
  store: DraftArtifactCleanupPersistence;
}): DraftArtifactCleanupResult {
  const removedFiles: string[] = [];
  const removedScopes: string[] = [];

  for (const project of input.store.listProjects()) {
    const result = cleanupProjectDraftArtifacts({
      orphanScopeGraceMs: input.orphanScopeGraceMs,
      project,
      store: input.store,
    });
    removedFiles.push(...result.removedFiles);
    removedScopes.push(...result.removedScopes);
  }

  return {
    removedFiles,
    removedScopes,
  };
}
