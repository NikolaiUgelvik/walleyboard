import assert from "node:assert/strict";
import test from "node:test";

import {
  getBrowserOpenCommands,
  resolveBrowserUrl,
  shouldAutoOpenBrowser,
  tryOpenBrowser,
} from "./browser-launch.js";

test("resolveBrowserUrl prefers localhost for loopback hosts", () => {
  assert.equal(
    resolveBrowserUrl({ host: "127.0.0.1", port: "4310" }),
    "http://localhost:4310",
  );
  assert.equal(
    resolveBrowserUrl({ host: "0.0.0.0", port: "4310" }),
    "http://localhost:4310",
  );
  assert.equal(
    resolveBrowserUrl({ host: "::1", port: "4310" }),
    "http://localhost:4310",
  );
});

test("resolveBrowserUrl preserves explicit remote hosts and IPv6 addresses", () => {
  assert.equal(
    resolveBrowserUrl({ host: "192.168.1.25", port: "4010" }),
    "http://192.168.1.25:4010",
  );
  assert.equal(
    resolveBrowserUrl({ host: "2001:db8::10", port: "4010" }),
    "http://[2001:db8::10]:4010",
  );
});

test("shouldAutoOpenBrowser honors opt-out environment flags", () => {
  assert.equal(shouldAutoOpenBrowser({}), true);
  assert.equal(shouldAutoOpenBrowser({ BROWSER: "none" }), false);
  assert.equal(shouldAutoOpenBrowser({ WALLEYBOARD_NO_OPEN: "1" }), false);
});

test("getBrowserOpenCommands prefers native Windows browser launch from WSL", () => {
  assert.deepEqual(
    getBrowserOpenCommands({
      env: { WSL_DISTRO_NAME: "Ubuntu" },
      platform: "linux",
      url: "http://localhost:4000",
    }),
    [
      {
        command: "cmd.exe",
        args: ["/c", "start", "", "http://localhost:4000"],
      },
      {
        command: "wslview",
        args: ["http://localhost:4000"],
      },
      {
        command: "xdg-open",
        args: ["http://localhost:4000"],
      },
    ],
  );
});

test("tryOpenBrowser falls back when the first opener is unavailable", () => {
  const calls: Array<{ args: string[]; command: string }> = [];
  const unrefCalls: string[] = [];

  const opened = tryOpenBrowser("http://localhost:4000", {
    env: { WSL_DISTRO_NAME: "Ubuntu" },
    platform: "linux",
    spawnImpl(command, args) {
      calls.push({ command, args });
      if (command === "cmd.exe") {
        const error = new Error("missing");
        (error as Error & { code?: string }).code = "ENOENT";
        throw error;
      }

      return {
        unref() {
          unrefCalls.push(command);
        },
      };
    },
  });

  assert.equal(opened, true);
  assert.deepEqual(calls, [
    {
      command: "cmd.exe",
      args: ["/c", "start", "", "http://localhost:4000"],
    },
    {
      command: "wslview",
      args: ["http://localhost:4000"],
    },
  ]);
  assert.deepEqual(unrefCalls, ["wslview"]);
});

test("tryOpenBrowser stops after a non-retryable launcher failure", () => {
  const opened = tryOpenBrowser("http://localhost:4000", {
    platform: "linux",
    spawnImpl() {
      const error = new Error("permission denied");
      (error as Error & { code?: string }).code = "EACCES";
      throw error;
    },
  });

  assert.equal(opened, false);
});
