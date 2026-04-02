export function waitForTrackedExit(
  tracked: Map<string, unknown>,
  waitersById: Map<string, Set<(didExit: boolean) => void>>,
  id: string,
  timeoutMs: number,
): Promise<boolean> {
  if (!tracked.has(id)) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const resolver = (didExit: boolean) => {
      clearTimeout(timeoutId);
      const waiters = waitersById.get(id);
      waiters?.delete(resolver);
      if (waiters && waiters.size === 0) {
        waitersById.delete(id);
      }
      resolve(didExit);
    };

    const waiters = waitersById.get(id) ?? new Set();
    waiters.add(resolver);
    waitersById.set(id, waiters);

    const timeoutId = setTimeout(() => {
      resolver(false);
    }, timeoutMs);
  });
}

export function resolveTrackedExit(
  waitersById: Map<string, Set<(didExit: boolean) => void>>,
  id: string,
  didExit: boolean,
): void {
  const waiters = waitersById.get(id);
  if (!waiters) {
    return;
  }

  waitersById.delete(id);
  for (const resolve of waiters) {
    resolve(didExit);
  }
}
