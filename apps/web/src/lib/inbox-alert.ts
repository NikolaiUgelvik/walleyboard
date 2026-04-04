export function hasNewInboxItems(
  previousKeys: readonly string[] | null,
  currentKeys: readonly string[],
  ignoredKeys: ReadonlySet<string> = new Set<string>(),
  knownKeys: ReadonlySet<string> = new Set(previousKeys ?? []),
): boolean {
  if (previousKeys === null) {
    return false;
  }

  return currentKeys.some(
    (key) =>
      !knownKeys.has(key) &&
      !Array.from(ignoredKeys).some(
        (ignoredKey) => key === ignoredKey || key.startsWith(`${ignoredKey}:`),
      ),
  );
}
