export function createKeyedSerialTaskRunner() {
  const tails = new Map<string, Promise<void>>();

  return async function runWithKey<T>(
    key: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    tails.set(key, tail);

    await previous.catch(() => undefined);

    try {
      return await task();
    } finally {
      releaseCurrent();
      if (tails.get(key) === tail) {
        tails.delete(key);
      }
    }
  };
}
