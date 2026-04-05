import type {
  PullRequestRef,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

import type {
  DetailedRequestedChanges,
  GraphQlDiscussionCommentNode,
  GraphQlReviewNode,
} from "./github-pull-request-service-types.js";

export function buildRequestedChangesBody(
  ticket: TicketFrontmatter,
  linkedPr: PullRequestRef,
  details: DetailedRequestedChanges,
): string {
  const reviewer =
    details.reviewerLogin ?? linkedPr.changes_requested_by ?? null;
  const lines = [
    `GitHub requested changes on PR #${linkedPr.number} (${linkedPr.url}).`,
    `Reviewer: ${reviewer ? `@${reviewer}` : "Unknown reviewer"}`,
  ];

  if (details.submittedAt) {
    lines.push(`Submitted at: ${details.submittedAt}`);
  }

  if (details.summary) {
    lines.push("", "Review summary:", details.summary);
  }

  if (details.comments.length > 0) {
    lines.push("", "Inline comments:");
    for (const comment of details.comments) {
      const location =
        comment.path && comment.line
          ? `${comment.path}:${comment.line}`
          : (comment.path ?? "General");
      lines.push(`- ${location}: ${comment.body}`);
    }
  }

  if (details.discussionComments.length > 0) {
    lines.push("", "PR discussion comments:");
    for (const comment of details.discussionComments) {
      lines.push(`- ${comment}`);
    }
  }

  if (
    details.comments.length === 0 &&
    details.discussionComments.length === 0
  ) {
    lines.push(
      "",
      `No inline or PR discussion comments were returned for the latest requested-changes review on ticket #${ticket.id}.`,
    );
  }

  return lines.join("\n");
}

function extractRequestedChangesDiscussionComments(
  comments: GraphQlDiscussionCommentNode[],
  reviewerLogin: string | null,
  submittedAt: string | null,
): string[] {
  if (!reviewerLogin) {
    return [];
  }

  return comments
    .filter(
      (comment): comment is NonNullable<GraphQlDiscussionCommentNode> =>
        comment !== null &&
        typeof comment.body === "string" &&
        comment.body.trim().length > 0 &&
        comment.isMinimized !== true,
    )
    .filter((comment) => {
      const authorLogin =
        comment.author &&
        typeof comment.author.login === "string" &&
        comment.author.login.length > 0
          ? comment.author.login
          : null;
      if (authorLogin !== reviewerLogin) {
        return false;
      }
      if (
        submittedAt &&
        typeof comment.createdAt === "string" &&
        comment.createdAt.localeCompare(submittedAt) < 0
      ) {
        return false;
      }

      return true;
    })
    .map((comment) => (comment.body as string).trim());
}

export function extractLatestRequestedChangesReview(
  reviews: GraphQlReviewNode[],
  discussionComments: GraphQlDiscussionCommentNode[] = [],
): DetailedRequestedChanges {
  const requestedChangesReviews = reviews
    .filter(
      (review): review is NonNullable<GraphQlReviewNode> =>
        review !== null && review.state === "CHANGES_REQUESTED",
    )
    .sort((left, right) => {
      const leftValue =
        typeof left.submittedAt === "string" ? left.submittedAt : "";
      const rightValue =
        typeof right.submittedAt === "string" ? right.submittedAt : "";
      return rightValue.localeCompare(leftValue);
    });
  const latestReview = requestedChangesReviews[0] ?? null;

  if (!latestReview) {
    return {
      reviewerLogin: null,
      submittedAt: null,
      summary: null,
      comments: [],
      discussionComments: [],
    };
  }

  const reviewerLogin =
    latestReview.author &&
    typeof latestReview.author.login === "string" &&
    latestReview.author.login.length > 0
      ? latestReview.author.login
      : null;
  const submittedAt =
    typeof latestReview.submittedAt === "string"
      ? latestReview.submittedAt
      : null;

  return {
    reviewerLogin,
    submittedAt,
    summary:
      typeof latestReview.body === "string" &&
      latestReview.body.trim().length > 0
        ? latestReview.body.trim()
        : null,
    comments: (latestReview.comments?.nodes ?? [])
      .filter(
        (comment): comment is NonNullable<typeof comment> =>
          comment !== null &&
          typeof comment.body === "string" &&
          comment.body.trim().length > 0,
      )
      .map((comment) => ({
        body: comment.body as string,
        path: typeof comment.path === "string" ? comment.path : null,
        line:
          typeof comment.line === "number" && Number.isFinite(comment.line)
            ? comment.line
            : null,
      })),
    discussionComments: extractRequestedChangesDiscussionComments(
      discussionComments,
      reviewerLogin,
      submittedAt,
    ),
  };
}
