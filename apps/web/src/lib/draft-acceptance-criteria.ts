export function sanitizeDraftAcceptanceCriteria(
  acceptanceCriteria: string,
): string[] {
  return acceptanceCriteria
    .split("\n")
    .filter((criterion) => criterion.trim().length > 0);
}
