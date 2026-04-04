import assert from "node:assert/strict";
import test from "node:test";

import {
  readDiffLayoutPreference,
  writeDiffLayoutPreference,
} from "./shared-api.js";

function installWindow(localStorage: {
  getItem(key: string): string | null;
  removeItem?(key: string): void;
  setItem(key: string, value: string): void;
}): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "window",
  );

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage,
    },
    writable: true,
  });

  return () => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "window", originalDescriptor);
      return;
    }

    Reflect.deleteProperty(globalThis, "window");
  };
}

test("readDiffLayoutPreference falls back to split when localStorage access throws", () => {
  const restoreWindow = installWindow({
    getItem() {
      throw new Error("storage disabled");
    },
    setItem() {
      throw new Error("unused");
    },
  });

  try {
    assert.equal(readDiffLayoutPreference(), "split");
  } finally {
    restoreWindow();
  }
});

test("writeDiffLayoutPreference ignores localStorage failures", () => {
  const restoreWindow = installWindow({
    getItem() {
      return null;
    },
    setItem() {
      throw new Error("storage disabled");
    },
  });

  try {
    assert.doesNotThrow(() => {
      writeDiffLayoutPreference("stacked");
    });
  } finally {
    restoreWindow();
  }
});
