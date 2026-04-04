import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveVitePreviewOptions,
  resolveViteServerOptions,
} from "./vite-server-options.js";

test("resolveViteServerOptions uses HOST and PORT when provided", () => {
  assert.deepEqual(
    resolveViteServerOptions({
      HOST: "127.0.0.1",
      PORT: "45491",
    }),
    {
      host: "127.0.0.1",
      port: 45491,
    },
  );
});

test("resolveViteServerOptions falls back to the default dev port", () => {
  assert.deepEqual(resolveViteServerOptions({}), {
    port: 5173,
  });
  assert.deepEqual(
    resolveViteServerOptions({
      HOST: " ",
      PORT: "not-a-port",
    }),
    {
      port: 5173,
    },
  );
});

test("resolveVitePreviewOptions falls back to the default preview port", () => {
  assert.deepEqual(resolveVitePreviewOptions({}), {
    port: 4173,
  });
});
