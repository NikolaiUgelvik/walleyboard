import type {
  PullRequestRef,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

export type PullRequestActionFailureAnnotation = {
  title: string | null;
  path: string | null;
  startLine: number | null;
  endLine: number | null;
  startColumn: number | null;
  endColumn: number | null;
  message: string | null;
  rawDetails: string | null;
};

export type PullRequestActionFailure = {
  kind: "check_run" | "status_context";
  name: string;
  state: string | null;
  conclusion: string | null;
  detailsUrl: string | null;
  summary: string | null;
  text: string | null;
  description: string | null;
  targetUrl: string | null;
  annotations: PullRequestActionFailureAnnotation[];
};

function appendAnnotations(
  sections: string[],
  annotations: PullRequestActionFailureAnnotation[],
): void {
  if (annotations.length === 0) {
    return;
  }

  sections.push("  Annotations:");
  for (const annotation of annotations) {
    const locationBase = annotation.path ?? "Unknown";
    const location =
      annotation.startLine !== null
        ? annotation.endLine !== null &&
          annotation.endLine !== annotation.startLine
          ? `${locationBase}:${annotation.startLine}-${annotation.endLine}`
          : `${locationBase}:${annotation.startLine}`
        : locationBase;
    const details = [
      annotation.title,
      annotation.message,
      annotation.rawDetails,
    ]
      .filter(
        (part): part is string =>
          typeof part === "string" && part.trim().length > 0,
      )
      .join(" | ");
    sections.push(
      `    - ${location}${details.length > 0 ? `: ${details}` : ""}`,
    );
  }
}

function appendFailureSections(
  sections: string[],
  failures: PullRequestActionFailure[],
): void {
  for (const failure of failures) {
    sections.push("", `### ${failure.name}`);
    sections.push(`- Kind: ${failure.kind}`);
    sections.push(`- State: ${failure.state ?? "None."}`);
    sections.push(`- Conclusion: ${failure.conclusion ?? "None."}`);
    sections.push(`- Details URL: ${failure.detailsUrl ?? "None."}`);
    if (failure.summary) {
      sections.push(`- Summary: ${failure.summary}`);
    }
    if (failure.text) {
      sections.push(`- Text: ${failure.text}`);
    }
    if (failure.description) {
      sections.push(`- Description: ${failure.description}`);
    }
    if (failure.targetUrl) {
      sections.push(`- Target URL: ${failure.targetUrl}`);
    }
    appendAnnotations(sections, failure.annotations);
  }
}

export function buildActionFailuresBody(
  ticket: TicketFrontmatter,
  linkedPr: PullRequestRef,
  failures: PullRequestActionFailure[],
): string {
  const sections = [
    `GitHub reported failing action checks on PR #${linkedPr.number} (${linkedPr.url}).`,
    `Ticket: #${ticket.id}`,
  ];

  if (failures.length === 0) {
    sections.push(
      "",
      `No completed failing check runs or status contexts were returned for ticket #${ticket.id}.`,
    );
    return sections.join("\n");
  }

  sections.push("", "CI Failure Facts");
  appendFailureSections(sections, failures);
  sections.push(
    "",
    "Fix the failing checks, keep the ticket intent intact, and push the repaired branch back to GitHub.",
  );
  return sections.join("\n");
}
