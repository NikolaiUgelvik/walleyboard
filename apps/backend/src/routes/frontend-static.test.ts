import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createIsolatedApp } from "../test-support/create-isolated-app.js";

function createStaticAssetDir(): string {
  const staticAssetDir = mkdtempSync(
    join(tmpdir(), "walleyboard-frontend-static-"),
  );

  mkdirSync(join(staticAssetDir, "assets"), { recursive: true });
  writeFileSync(
    join(staticAssetDir, "index.html"),
    '<!doctype html><html><body><div id="root">WalleyBoard</div></body></html>',
  );
  writeFileSync(join(staticAssetDir, "assets", "main.js"), "console.log(1);");

  return staticAssetDir;
}

test("serves the packaged frontend index from the backend root", async () => {
  const staticAssetDir = createStaticAssetDir();
  const { app, close } = await createIsolatedApp({
    staticAssetDir,
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/",
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] ?? "", /^text\/html\b/i);
    assert.match(response.body, /WalleyBoard/);
  } finally {
    await close();
    rmSync(staticAssetDir, { recursive: true, force: true });
  }
});

test("serves built frontend assets from the backend", async () => {
  const staticAssetDir = createStaticAssetDir();
  const { app, close } = await createIsolatedApp({
    staticAssetDir,
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/assets/main.js",
    });

    assert.equal(response.statusCode, 200);
    assert.match(
      response.headers["content-type"] ?? "",
      /^text\/javascript\b/i,
    );
    assert.equal(response.body, "console.log(1);");
  } finally {
    await close();
    rmSync(staticAssetDir, { recursive: true, force: true });
  }
});

test("returns a 404 payload for missing packaged frontend assets", async () => {
  const staticAssetDir = createStaticAssetDir();
  const { app, close } = await createIsolatedApp({
    staticAssetDir,
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/assets/missing.js",
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), {
      error: "Not Found",
      message: "Route GET:/assets/missing.js not found",
      statusCode: 404,
    });
  } finally {
    await close();
    rmSync(staticAssetDir, { recursive: true, force: true });
  }
});
