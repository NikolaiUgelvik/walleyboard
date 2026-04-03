export type MergeRecoveryKind = "conflicts" | "target_branch_advanced";

export function formatMergeRecoveryLaunchLabel(
  recoveryKind: MergeRecoveryKind,
) {
  return recoveryKind === "target_branch_advanced"
    ? "target-branch catch-up"
    : "merge-conflict resolution";
}

export function formatMergeRecoveryFailureNote(input: {
  adapterLabel: string;
  message: string;
  recoveryKind: MergeRecoveryKind;
  stage: "rebase" | "merge";
  targetBranch: string;
  when: "start" | "execution" | "finish";
}) {
  if (input.recoveryKind === "target_branch_advanced") {
    const prefix =
      input.when === "start"
        ? "could not start"
        : input.when === "execution"
          ? "execution failed"
          : "could not finish";
    return `${input.adapterLabel} ${prefix} while updating the ticket branch with the latest ${input.targetBranch} changes: ${input.message}`;
  }

  const prefix =
    input.when === "start"
      ? "could not start"
      : input.when === "execution"
        ? "execution failed"
        : "could not finish";
  const suffix =
    input.when === "finish"
      ? `resolving the ${input.stage} conflicts. ${input.message}`
      : `while resolving ${input.stage} conflicts: ${input.message}`;
  return `${input.adapterLabel} ${prefix} ${suffix}`;
}
