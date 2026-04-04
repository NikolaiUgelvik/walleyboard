import assert from "node:assert/strict";
import test from "node:test";

import {
  readDiffLayoutPreference,
  readInboxReadState,
  writeDiffLayoutPreference,
  writeInboxReadState,
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

test("readInboxReadState falls back to an empty object when storage is invalid", () => {
  const restoreWindow = installWindow({
    getItem() {
      return "{not valid json";
    },
    setItem() {
      throw new Error("unused");
    },
  });

  try {
    assert.deepEqual(readInboxReadState(), {});
  } finally {
    restoreWindow();
  }
});

test("writeInboxReadState serializes the read notification map", () => {
  let storedValue: string | null = null;
  const restoreWindow = installWindow({
    getItem() {
      return storedValue;
    },
    setItem(_key, value) {
      storedValue = value;
    },
  });

  try {
    writeInboxReadState({
      "draft-1": "draft-1:notification-2",
      "review-7": "review-7:session-9:attempt-3",
    });

    assert.deepEqual(readInboxReadState(), {
      "draft-1": "draft-1:notification-2",
      "review-7": "review-7:session-9:attempt-3",
    });
  } finally {
    restoreWindow();
  }
});
