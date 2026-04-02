export function hasNewInboxItems(
  previousKeys: readonly string[] | null,
  currentKeys: readonly string[],
  ignoredKeys: ReadonlySet<string> = new Set<string>(),
): boolean {
  if (previousKeys === null) {
    return false;
  }

  const previousKeySet = new Set(previousKeys);
  return currentKeys.some(
    (key) => !previousKeySet.has(key) && !ignoredKeys.has(key),
  );
}
