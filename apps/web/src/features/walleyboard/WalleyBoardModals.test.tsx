import assert from "node:assert/strict";
import test from "node:test";

import { MantineProvider } from "@mantine/core";
import { JSDOM } from "jsdom";
import React, { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { WorkspaceTerminalContent } from "./WorkspaceTerminalContent.js";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

class ResizeObserverStub {
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

function installGlobal(name: string, value: unknown): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  });

  return () => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, name, originalDescriptor);
      return;
    }

    Reflect.deleteProperty(globalThis, name);
  };
}

async function flushAsyncWork(
  pendingCallbacks: Map<number, () => void>,
): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });

  while (pendingCallbacks.size > 0) {
    const callbacks = Array.from(pendingCallbacks.values());
    pendingCallbacks.clear();

    await act(async () => {
      for (const callback of callbacks) {
        callback();
      }

      await Promise.resolve();
    });
  }
}

function installDom() {
  const dom = new JSDOM(
    "<!doctype html><html><head></head><body></body></html>",
    {
      pretendToBeVisual: true,
      url: "http://localhost/",
    },
  );
  const { window } = dom;
  const restoreGlobals = [
    installGlobal("IS_REACT_ACT_ENVIRONMENT", true),
    installGlobal("window", window),
    installGlobal("document", window.document),
    installGlobal("Document", window.Document),
    installGlobal("navigator", window.navigator),
    installGlobal("Element", window.Element),
    installGlobal("HTMLElement", window.HTMLElement),
    installGlobal("MutationObserver", window.MutationObserver),
    installGlobal("Node", window.Node),
    installGlobal("ResizeObserver", ResizeObserverStub),
    installGlobal("SVGElement", window.SVGElement),
  ];
  const pendingCallbacks = new Map<number, () => void>();
  let nextAsyncId = 1;
  const scheduleCallback = (
    callback: TimerHandler,
    args: unknown[],
  ): number => {
    const id = nextAsyncId;
    nextAsyncId += 1;
    pendingCallbacks.set(id, () => {
      if (typeof callback === "function") {
        callback(...args);
        return;
      }

      throw new TypeError(
        "String timers are not supported in this test harness",
      );
    });
    return id;
  };
  const clearScheduledCallback = (id: number): void => {
    pendingCallbacks.delete(id);
  };

  window.matchMedia = () =>
    ({
      addEventListener() {},
      addListener() {},
      dispatchEvent() {
        return false;
      },
      matches: false,
      media: "(prefers-color-scheme: light)",
      onchange: null,
      removeEventListener() {},
      removeListener() {},
    }) as MediaQueryList;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.setTimeout = ((
    callback: TimerHandler,
    _delay?: number,
    ...args: unknown[]
  ) => scheduleCallback(callback, args)) as typeof window.setTimeout;
  window.clearTimeout = ((id: number) => {
    clearScheduledCallback(id);
  }) as typeof window.clearTimeout;
  window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    scheduleCallback(
      () => callback(Date.now()),
      [],
    )) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => {
    clearScheduledCallback(id);
  }) as typeof window.cancelAnimationFrame;
  restoreGlobals.push(
    installGlobal("getComputedStyle", window.getComputedStyle.bind(window)),
    installGlobal(
      "setTimeout",
      window.setTimeout.bind(window) as typeof globalThis.setTimeout,
    ),
    installGlobal(
      "clearTimeout",
      window.clearTimeout.bind(window) as typeof globalThis.clearTimeout,
    ),
    installGlobal(
      "requestAnimationFrame",
      window.requestAnimationFrame.bind(window),
    ),
    installGlobal(
      "cancelAnimationFrame",
      window.cancelAnimationFrame.bind(window),
    ),
  );

  const mountNode = window.document.createElement("div");
  window.document.body.appendChild(mountNode);

  return {
    flushAsyncWork: () => flushAsyncWork(pendingCallbacks),
    mountNode,
    window,
    cleanup() {
      mountNode.remove();
      for (const restore of restoreGlobals.reverse()) {
        restore();
      }
      dom.window.close();
    },
  };
}

test("repository terminal tabs preserve each tab instance and resolved path across tab switches", async () => {
  const harness = installDom();
  const root = createRoot(harness.mountNode);
  const mounts = new Map<string, number>();
  const unmounts = new Map<string, number>();

  const TerminalStub = ({
    socketPath,
    worktreePath,
  }: {
    socketPath: string;
    surfaceLabel: "ticket" | "repository";
    worktreePath: string | null;
  }) => {
    const [resolvedPath, setResolvedPath] = useState<string | null>(
      "starting...",
    );

    useEffect(() => {
      mounts.set(socketPath, (mounts.get(socketPath) ?? 0) + 1);

      return () => {
        unmounts.set(socketPath, (unmounts.get(socketPath) ?? 0) + 1);
      };
    }, [socketPath]);

    return (
      <div data-socket-path={socketPath}>
        <button type="button" onClick={() => setResolvedPath(worktreePath)}>
          Resolve {socketPath}
        </button>
        <span>{resolvedPath}</span>
      </div>
    );
  };

  const workspaceTerminalContext = {
    kind: "repository_tabs" as const,
    repositories: [
      {
        id: "repo-1",
        label: "repo",
        socketPath: "/projects/project-1/repositories/repo-1/terminal",
        worktreePath: "/tmp/repo",
      },
      {
        id: "repo-2",
        label: "api",
        socketPath: "/projects/project-1/repositories/repo-2/terminal",
        worktreePath: "/tmp/api",
      },
    ],
    surfaceLabel: "repository" as const,
  };

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <WorkspaceTerminalContent
            selectedSessionTicket={null}
            workspaceTerminalContext={workspaceTerminalContext}
            workspaceTerminalPanelState={{
              error: null,
              state: "preparing",
              worktreePath: null,
            }}
            TerminalComponent={TerminalStub}
          />
        </MantineProvider>,
      );
    });
    await harness.flushAsyncWork();

    const tabs = Array.from(
      harness.window.document.querySelectorAll<HTMLElement>('[role="tab"]'),
    );
    const repoTab = tabs.find((tab) => tab.textContent?.trim() === "repo");
    const apiTab = tabs.find((tab) => tab.textContent?.trim() === "api");
    assert.ok(repoTab);
    assert.ok(apiTab);

    const repoResolveButton = harness.window.document.querySelector(
      'div[data-socket-path="/projects/project-1/repositories/repo-1/terminal"] button',
    );
    assert.ok(repoResolveButton);
    await act(async () => {
      repoResolveButton.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
    });
    await harness.flushAsyncWork();

    assert.equal(
      mounts.get("/projects/project-1/repositories/repo-1/terminal"),
      1,
    );
    assert.equal(
      mounts.get("/projects/project-1/repositories/repo-2/terminal") ?? 0,
      0,
    );

    await act(async () => {
      apiTab.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
    });
    await harness.flushAsyncWork();

    const apiResolveButton = harness.window.document.querySelector(
      'div[data-socket-path="/projects/project-1/repositories/repo-2/terminal"] button',
    );
    assert.ok(apiResolveButton);
    assert.equal(
      mounts.get("/projects/project-1/repositories/repo-2/terminal"),
      1,
    );
    await act(async () => {
      apiResolveButton.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
    });
    await harness.flushAsyncWork();

    await act(async () => {
      repoTab.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
    });
    await harness.flushAsyncWork();

    const repoTerminal = harness.window.document.querySelector(
      'div[data-socket-path="/projects/project-1/repositories/repo-1/terminal"]',
    );
    assert.ok(repoTerminal);
    assert.match(repoTerminal.textContent ?? "", /\/tmp\/repo/);
    assert.equal(
      mounts.get("/projects/project-1/repositories/repo-1/terminal"),
      1,
    );
    assert.equal(
      unmounts.get("/projects/project-1/repositories/repo-1/terminal") ?? 0,
      0,
    );
    assert.equal(
      unmounts.get("/projects/project-1/repositories/repo-2/terminal") ?? 0,
      0,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    harness.cleanup();
  }
});
