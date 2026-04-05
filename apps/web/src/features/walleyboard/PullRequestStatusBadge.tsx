import { Badge } from "@mantine/core";
// @ts-expect-error Tabler deep icon entrypoints do not ship declaration files.
import IconGitMerge from "@tabler/icons-react/dist/esm/icons/IconGitMerge.mjs";
// @ts-expect-error Tabler deep icon entrypoints do not ship declaration files.
import IconGitPullRequest from "@tabler/icons-react/dist/esm/icons/IconGitPullRequest.mjs";
// @ts-expect-error Tabler deep icon entrypoints do not ship declaration files.
import IconGitPullRequestClosed from "@tabler/icons-react/dist/esm/icons/IconGitPullRequestClosed.mjs";
import type React from "react";

import type { PullRequestRef } from "../../../../../packages/contracts/src/index.js";
import {
  formatPullRequestBadgeLabel,
  pullRequestBadgeColor,
} from "./shared-utils.js";

function PullRequestStatusIcon({
  state,
}: {
  state: PullRequestRef["state"];
}): React.JSX.Element {
  switch (state) {
    case "closed":
      return <IconGitPullRequestClosed size={12} stroke={1.8} />;
    case "merged":
      return <IconGitMerge size={12} stroke={1.8} />;
    default:
      return <IconGitPullRequest size={12} stroke={1.8} />;
  }
}

export function PullRequestStatusBadge({
  linkedPr,
}: {
  linkedPr: PullRequestRef;
}): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      color={pullRequestBadgeColor(linkedPr)}
      leftSection={<PullRequestStatusIcon state={linkedPr.state} />}
    >
      {formatPullRequestBadgeLabel(linkedPr)}
    </Badge>
  );
}
