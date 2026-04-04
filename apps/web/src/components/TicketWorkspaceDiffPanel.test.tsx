import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MantineProvider } from "@mantine/core";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import type { TicketWorkspaceDiff } from "../../../../packages/contracts/src/index.js";
import { TicketWorkspaceDiffPanel } from "./TicketWorkspaceDiffPanel.js";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const stylesheet = readFileSync(
  new URL("../app-shell.css", import.meta.url),
  "utf8",
);

const sampleDiff: TicketWorkspaceDiff = {
  artifact_path: null,
  generated_at: "2026-04-03T00:00:00.000Z",
  patch: [
    "diff --git a/src/example.ts b/src/example.ts",
    "index 1111111..2222222 100644",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -1,3 +1,4 @@",
    " const alpha = 1;",
    '-const beta = "old";',
    '+const beta = "new";',
    "+const gamma = true;",
    " export { alpha, beta };",
  ].join("\n"),
  source: "live_worktree",
  target_branch: "main",
  ticket_id: 18,
  working_branch: "ticket-18",
  worktree_path: "/workspace",
};

type DomHarness = {
  cleanup: () => void;
  flushAsyncWork: () => Promise<void>;
  mountNode: HTMLElement;
};

class ResizeObserverStub {
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

function extractRule(source: string, selector: string): string {
  const markerIndex = source.indexOf(selector);
  assert.notEqual(markerIndex, -1, `Missing CSS rule for ${selector}`);

  const blockStart = source.indexOf("{", markerIndex);
  assert.notEqual(blockStart, -1, `Missing opening brace for ${selector}`);

  let depth = 1;
  for (let index = blockStart + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return `${selector} ${source.slice(blockStart, index + 1)}`;
      }
    }
  }

  throw new Error(`Missing closing brace for ${selector}`);
}

function createDiffStylesheet(): string {
  return [
    extractRule(stylesheet, ':root[data-mantine-color-scheme="light"]'),
    extractRule(stylesheet, ':root[data-mantine-color-scheme="dark"]'),
    extractRule(stylesheet, ".ticket-workspace-diff-renderer"),
  ].join("\n");
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

async function waitForElement<T>(
  selectElement: () => T | null,
  flushWork: () => Promise<void>,
  message: string,
): Promise<T> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const element = selectElement();
    if (element) {
      return element;
    }

    await flushWork();
  }

  const element = selectElement();
  assert.ok(element, message);
  return element;
}

function installDom(): DomHarness {
  const dom = new JSDOM(
    "<!doctype html><html><head></head><body></body></html>",
    {
      pretendToBeVisual: true,
      url: "http://localhost/",
    },
  );
  const { window } = dom;
  const restoreGlobals = [
    installGlobal("window", window),
    installGlobal("document", window.document),
    installGlobal("navigator", window.navigator),
    installGlobal("HTMLElement", window.HTMLElement),
    installGlobal("MutationObserver", window.MutationObserver),
    installGlobal("Node", window.Node),
    installGlobal("ResizeObserver", ResizeObserverStub),
    installGlobal("ShadowRoot", window.ShadowRoot),
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
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      removeEventListener() {},
      removeListener() {},
    }) as MediaQueryList;
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
      window.requestAnimationFrame.bind(
        window,
      ) as typeof globalThis.requestAnimationFrame,
    ),
    installGlobal(
      "cancelAnimationFrame",
      window.cancelAnimationFrame.bind(
        window,
      ) as typeof globalThis.cancelAnimationFrame,
    ),
    installGlobal("IS_REACT_ACT_ENVIRONMENT", true),
  );

  const styleTag = window.document.createElement("style");
  styleTag.textContent = createDiffStylesheet();
  window.document.head.append(styleTag);

  const mountNode = window.document.createElement("div");
  window.document.body.append(mountNode);

  return {
    cleanup: () => {
      mountNode.remove();
      dom.window.close();
      for (const restore of restoreGlobals.reverse()) {
        restore();
      }
    },
    flushAsyncWork: () => flushAsyncWork(pendingCallbacks),
    mountNode,
  };
}

async function waitForRenderer(
  mountNode: HTMLElement,
  layout: "split" | "stacked",
  flushWork: () => Promise<void>,
): Promise<HTMLElement> {
  const diffSelector =
    layout === "split"
      ? '[data-diff-type="split"]'
      : '[data-diff-type="single"][data-overflow="scroll"]';
  const rendererWrapper = await waitForElement(
    () =>
      mountNode.querySelector<HTMLDivElement>(
        ".ticket-workspace-diff-renderer",
      ),
    flushWork,
    `Expected ${layout} diff renderer host`,
  );
  const renderer = await waitForElement(
    () => rendererWrapper.querySelector<HTMLElement>("diffs-container"),
    flushWork,
    `Expected ${layout} diff container host`,
  );
  const renderedDiff = await waitForElement(
    () => renderer.shadowRoot?.querySelector(diffSelector),
    flushWork,
    `Expected ${layout} diff render after settle`,
  );
  assert.ok(renderedDiff);

  return renderer;
}

async function renderPanel(input: {
  colorScheme: "light" | "dark";
  layout: "split" | "stacked";
}): Promise<{ cleanup: () => Promise<void>; renderer: HTMLElement }> {
  const harness = installDom();
  const root = createRoot(harness.mountNode);

  await act(async () => {
    root.render(
      <MantineProvider env="test" forceColorScheme={input.colorScheme}>
        <TicketWorkspaceDiffPanel
          diff={sampleDiff}
          isLoading={false}
          layout={input.layout}
          onLayoutChange={() => undefined}
        />
      </MantineProvider>,
    );
  });

  const renderer = await waitForRenderer(
    harness.mountNode,
    input.layout,
    harness.flushAsyncWork,
  );

  return {
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      harness.cleanup();
    },
    renderer,
  };
}

test("diff panel renders both layouts and injects shadow-root styling", async () => {
  const split = await renderPanel({
    colorScheme: "light",
    layout: "split",
  });
  try {
    const splitShadow = split.renderer.shadowRoot;
    assert.ok(splitShadow, "Expected split renderer shadow root");
    assert.ok(
      splitShadow.querySelector('[data-diff-type="split"]'),
      "Expected split diff container",
    );
    assert.ok(
      splitShadow.querySelector("style[data-core-css]"),
      "Expected fallback core diff stylesheet in the shadow root",
    );
    assert.match(splitShadow.textContent ?? "", /const beta = "old";/);
    assert.match(splitShadow.textContent ?? "", /const beta = "new";/);
    const unsafeStyle = Array.from(splitShadow.querySelectorAll("style")).find(
      (style) =>
        style.textContent?.includes("var(--walleyboard-diff-row-divider)"),
    );
    assert.ok(
      unsafeStyle,
      "Expected injected shadow-root stylesheet for diff-specific chrome",
    );
  } finally {
    await split.cleanup();
  }

  const stacked = await renderPanel({
    colorScheme: "dark",
    layout: "stacked",
  });
  try {
    const stackedShadow = stacked.renderer.shadowRoot;
    assert.ok(stackedShadow, "Expected stacked renderer shadow root");
    assert.ok(
      stackedShadow.querySelector(
        '[data-diff-type="single"] [data-unified], [data-diff-type="single"][data-overflow="scroll"] [data-unified]',
      ),
      "Expected unified diff content for stacked layout",
    );
    assert.match(stackedShadow.textContent ?? "", /const gamma = true;/);
  } finally {
    await stacked.cleanup();
  }
});

test("diff panel switches host diff variables between light and dark modes", async () => {
  const light = await renderPanel({
    colorScheme: "light",
    layout: "split",
  });
  let lightAddition = "";
  let lightThemeCss = "";
  try {
    lightAddition = Array.from(
      light.renderer.shadowRoot?.querySelectorAll("style") ?? [],
    )
      .map((style) => style.textContent ?? "")
      .join("\n");
    lightThemeCss = light.renderer.shadowRoot?.textContent ?? "";
    assert.equal(
      document.documentElement.getAttribute("data-mantine-color-scheme"),
      "light",
    );
  } finally {
    await light.cleanup();
  }

  const dark = await renderPanel({
    colorScheme: "dark",
    layout: "split",
  });
  try {
    const darkThemeCss =
      Array.from(dark.renderer.shadowRoot?.querySelectorAll("style") ?? [])
        .map((style) => style.textContent ?? "")
        .join("\n") +
      "\n" +
      (dark.renderer.shadowRoot?.textContent ?? "");

    assert.equal(
      document.documentElement.getAttribute("data-mantine-color-scheme"),
      "dark",
    );
    assert.match(lightAddition, /var\(--walleyboard-diff-row-divider\)/);
    assert.match(lightThemeCss, /color-scheme:\s*light/);
    assert.match(darkThemeCss, /color-scheme:\s*dark/);
  } finally {
    await dark.cleanup();
  }
});
