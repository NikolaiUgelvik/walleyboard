import assert from "node:assert/strict";
import test from "node:test";

function installWindow(origin: string): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "window",
  );

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        origin,
      },
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

async function importApiBaseUrlModule(cacheKey: string) {
  return import(new URL(`./api-base-url.ts?${cacheKey}`, import.meta.url).href);
}

test("uses the current browser origin when no explicit API base URL is provided", async () => {
  const restoreWindow = installWindow("http://127.0.0.1:4310");

  try {
    const module = await importApiBaseUrlModule("window-origin");

    assert.equal(module.apiBaseUrl, "http://127.0.0.1:4310");
    assert.equal(
      module.resolveProjectArtifactHref(
        "/projects/project-1/artifacts/image.png",
      ),
      "http://127.0.0.1:4310/projects/project-1/artifacts/image.png",
    );
  } finally {
    restoreWindow();
  }
});

test("falls back to the local backend port when window is unavailable", async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "window",
  );
  if (originalDescriptor) {
    Reflect.deleteProperty(globalThis, "window");
  }

  try {
    const module = await importApiBaseUrlModule("no-window");

    assert.equal(module.apiBaseUrl, "http://127.0.0.1:4000");
    assert.equal(
      module.resolveApiPath("/health"),
      "http://127.0.0.1:4000/health",
    );
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "window", originalDescriptor);
    }
  }
});
