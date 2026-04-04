import { parsePatchFiles } from "@pierre/diffs";
import type { TicketWorkspaceDiff } from "../../../../packages/contracts/src/index.js";

export type TicketWorkspaceDiffSummary = {
  additions: number;
  deletions: number;
  files: number;
};

export function summarizeTicketWorkspaceDiff(
  diff: TicketWorkspaceDiff,
): TicketWorkspaceDiffSummary | null {
  try {
    const files = parsePatchFiles(diff.patch).flatMap((patch) => patch.files);
    if (files.length === 0) {
      return null;
    }

    return files.reduce(
      (summary, file) => ({
        additions:
          summary.additions +
          file.hunks.reduce((count, hunk) => count + hunk.additionLines, 0),
        deletions:
          summary.deletions +
          file.hunks.reduce((count, hunk) => count + hunk.deletionLines, 0),
        files: summary.files + 1,
      }),
      { additions: 0, deletions: 0, files: 0 },
    );
  } catch {
    return null;
  }
}
