import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";
import { resolveDockerMountedPath } from "../agent-adapters/docker-paths.js";
import type { ExecutionRuntimePersistence } from "../store.js";
import type { PromptContextSection } from "./types.js";

const missingPatchMessage = "No persisted patch artifact is available yet.";
const unavailablePatchMessage =
  "Persisted patch artifact is not available inside Docker.";

export function buildReferencedTicketContextSections(input: {
  store: Pick<
    ExecutionRuntimePersistence,
    "getReviewPackage" | "getRepository" | "getTicket"
  >;
  ticket: TicketFrontmatter;
  worktreePath: string;
}): PromptContextSection[] {
  return (input.ticket.ticket_references ?? []).map((reference) => {
    const referencedTicket = input.store.getTicket(reference.ticket_id);
    const repository = referencedTicket
      ? input.store.getRepository(referencedTicket.repo)
      : undefined;
    const reviewPackage = referencedTicket
      ? input.store.getReviewPackage(referencedTicket.id)
      : undefined;
    const patchPath =
      reviewPackage?.diff_ref && reviewPackage.diff_ref.length > 0
        ? resolveDockerMountedPath({
            hostPath: reviewPackage.diff_ref,
            worktreePath: input.worktreePath,
          })
        : null;

    return {
      label: `Referenced ticket #${reference.ticket_id}`,
      content: [
        `Ticket: #${reference.ticket_id}`,
        `Title: ${referencedTicket?.title ?? reference.title}`,
        `Status: ${referencedTicket?.status ?? reference.status}`,
        `Repository: ${repository?.name ?? "Unknown"}`,
        `Patch file: ${
          patchPath
            ? patchPath
            : reviewPackage?.diff_ref
              ? unavailablePatchMessage
              : missingPatchMessage
        }`,
      ].join("\n"),
    };
  });
}
