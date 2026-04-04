function isIgnoredInboxItemKey(
  key: string,
  ignoredKeys: ReadonlySet<string>,
): boolean {
  return Array.from(ignoredKeys).some(
    (ignoredKey) => key === ignoredKey || key.startsWith(`${ignoredKey}:`),
  );
}

export function getNewInboxItemKeys(
  previousKeys: readonly string[] | null,
  currentKeys: readonly string[],
  ignoredKeys: ReadonlySet<string> = new Set<string>(),
  knownKeys: ReadonlySet<string> = new Set(previousKeys ?? []),
): string[] {
  if (previousKeys === null) {
    return [];
  }

  return currentKeys.filter(
    (key) => !knownKeys.has(key) && !isIgnoredInboxItemKey(key, ignoredKeys),
  );
}

export function hasNewInboxItems(
  previousKeys: readonly string[] | null,
  currentKeys: readonly string[],
  ignoredKeys: ReadonlySet<string> = new Set<string>(),
  knownKeys: ReadonlySet<string> = new Set(previousKeys ?? []),
): boolean {
  return (
    getNewInboxItemKeys(previousKeys, currentKeys, ignoredKeys, knownKeys)
      .length > 0
  );
}
