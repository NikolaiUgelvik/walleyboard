import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MantineProvider } from "@mantine/core";
import { FileDiff } from "@pierre/diffs";
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
const diffExplorerSizeStorageKey =
  "walleyboard.ticket-workspace.diff-explorer-size";

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

const explorerDiff = {
  ...sampleDiff,
  patch: [
    "diff --git a/apps/web/src/app-shell.css b/apps/web/src/app-shell.css",
    "index 5555555..6666666 100644",
    "--- a/apps/web/src/app-shell.css",
    "+++ b/apps/web/src/app-shell.css",
    "@@ -1 +1 @@",
    "-body { background: #000; }",
    "+body { background: #111; }",
    "diff --git a/apps/web/src/app-shell.test.ts b/apps/web/src/app-shell.test.ts",
    "new file mode 100644",
    "index 0000000..7777777",
    "--- /dev/null",
    "+++ b/apps/web/src/app-shell.test.ts",
    "@@ -0,0 +1 @@",
    '+assert.equal(theme, "dark");',
    "diff --git a/apps/web/src/components/MarkdownCodeEditor.test.ts b/apps/web/src/components/MarkdownCodeEditor.test.ts",
    "index 1111111..2222222 100644",
    "--- a/apps/web/src/components/MarkdownCodeEditor.test.ts",
    "+++ b/apps/web/src/components/MarkdownCodeEditor.test.ts",
    "@@ -1 +1 @@",
    '-assert.equal(mode, "preview");',
    '+assert.equal(mode, "edit");',
    "diff --git a/apps/web/src/components/MarkdownCodeEditor.tsx b/apps/web/src/components/MarkdownCodeEditor.tsx",
    "index 3333333..4444444 100644",
    "--- a/apps/web/src/components/MarkdownCodeEditor.tsx",
    "+++ b/apps/web/src/components/MarkdownCodeEditor.tsx",
    "@@ -1 +1 @@",
    '-const label = "Preview";',
    '+const label = "Edit";',
  ].join("\n"),
};

const selectionBaseDiff = {
  ...sampleDiff,
  patch: [
    "diff --git a/src/alpha.ts b/src/alpha.ts",
    "index 1111111..2222222 100644",
    "--- a/src/alpha.ts",
    "+++ b/src/alpha.ts",
    "@@ -1 +1 @@",
    "-alphaOld();",
    "+alphaNew();",
    "diff --git a/src/bravo.ts b/src/bravo.ts",
    "index 3333333..4444444 100644",
    "--- a/src/bravo.ts",
    "+++ b/src/bravo.ts",
    "@@ -1 +1 @@",
    "-bravoOld();",
    "+bravoNew();",
  ].join("\n"),
};

const selectionPreservedDiff = {
  ...sampleDiff,
  patch: [
    "diff --git a/src/charlie.ts b/src/charlie.ts",
    "index 1111111..2222222 100644",
    "--- a/src/charlie.ts",
    "+++ b/src/charlie.ts",
    "@@ -1 +1 @@",
    "-charlieOld();",
    "+charlieNew();",
    "diff --git a/src/bravo.ts b/src/bravo.ts",
    "index 3333333..4444444 100644",
    "--- a/src/bravo.ts",
    "+++ b/src/bravo.ts",
    "@@ -1 +1 @@",
    "-bravoOlder();",
    "+bravoNewest();",
  ].join("\n"),
};

const selectionFallbackDiff = {
  ...sampleDiff,
  patch: [
    "diff --git a/src/charlie.ts b/src/charlie.ts",
    "index 1111111..2222222 100644",
    "--- a/src/charlie.ts",
    "+++ b/src/charlie.ts",
    "@@ -1 +1 @@",
    "-charlieOlder();",
    "+charlieNewest();",
    "diff --git a/src/delta.ts b/src/delta.ts",
    "index 3333333..4444444 100644",
    "--- a/src/delta.ts",
    "+++ b/src/delta.ts",
    "@@ -1 +1 @@",
    "-deltaOld();",
    "+deltaNew();",
  ].join("\n"),
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
    installGlobal("CustomEvent", window.CustomEvent),
    installGlobal("Event", window.Event),
    installGlobal("HTMLElement", window.HTMLElement),
    installGlobal("StorageEvent", window.StorageEvent),
    installGlobal("MutationObserver", window.MutationObserver),
    installGlobal("Node", window.Node),
    installGlobal("ResizeObserver", ResizeObserverStub),
    installGlobal("ShadowRoot", window.ShadowRoot),
    installGlobal("SVGElement", window.SVGElement),
    installGlobal("Image", window.Image),
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
  diff?: TicketWorkspaceDiff;
  layout: "split" | "stacked";
  storage?: Record<string, string>;
}): Promise<{
  cleanup: () => Promise<void>;
  flushAsyncWork: () => Promise<void>;
  mountNode: HTMLElement;
  renderer: HTMLElement;
  rerender: (diff: TicketWorkspaceDiff) => Promise<void>;
  setLayout: (layout: "split" | "stacked") => Promise<void>;
}> {
  const harness = installDom();
  for (const [key, value] of Object.entries(input.storage ?? {})) {
    window.localStorage.setItem(key, value);
  }
  const root = createRoot(harness.mountNode);
  const colorScheme = input.colorScheme;
  let currentLayout = input.layout;
  let currentDiff = input.diff ?? sampleDiff;

  const renderDiffPanel = async () => {
    await act(async () => {
      root.render(
        <MantineProvider env="test" forceColorScheme={colorScheme}>
          <TicketWorkspaceDiffPanel
            diff={currentDiff}
            isLoading={false}
            layout={currentLayout}
            onLayoutChange={() => undefined}
          />
        </MantineProvider>,
      );
    });
  };

  await renderDiffPanel();

  const renderer = await waitForRenderer(
    harness.mountNode,
    currentLayout,
    harness.flushAsyncWork,
  );

  return {
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      harness.cleanup();
    },
    flushAsyncWork: harness.flushAsyncWork,
    mountNode: harness.mountNode,
    renderer,
    rerender: async (diff) => {
      currentDiff = diff;
      await renderDiffPanel();
      await harness.flushAsyncWork();
    },
    setLayout: async (layout) => {
      currentLayout = layout;
      await renderDiffPanel();
      await waitForRenderer(
        harness.mountNode,
        currentLayout,
        harness.flushAsyncWork,
      );
      await harness.flushAsyncWork();
    },
  };
}

function getTreeNodeOrder(mountNode: HTMLElement): string[] {
  return Array.from(
    mountNode.querySelectorAll<HTMLElement>(
      ".ticket-workspace-diff-tree-node[data-node-id]",
    ),
  ).map((node) => node.dataset.nodeId ?? "");
}

async function clickTreeNode(
  mountNode: HTMLElement,
  nodeId: string,
): Promise<HTMLElement> {
  const node = mountNode.querySelector<HTMLElement>(
    `.ticket-workspace-diff-tree-node[data-node-id="${nodeId}"]`,
  );
  assert.ok(node, `Expected tree node ${nodeId}`);

  await act(async () => {
    node.dispatchEvent(
      new window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  return node;
}

function getSelectedDiffFile(mountNode: HTMLElement): HTMLElement | null {
  return mountNode.querySelector<HTMLElement>(
    '.ticket-workspace-diff-file[data-selected="true"], .ticket-workspace-diff-file[data-selected]',
  );
}

function getRenderedDiffFileOrder(mountNode: HTMLElement): string[] {
  return Array.from(
    mountNode.querySelectorAll<HTMLElement>(".ticket-workspace-diff-file"),
  ).map((file) => file.dataset.fileKey ?? "");
}

function getSelectedTreeFileKey(mountNode: HTMLElement): string | null {
  return (
    mountNode.querySelector<HTMLElement>(
      '.ticket-workspace-diff-tree-node[data-selected="true"], .ticket-workspace-diff-tree-node[data-selected]',
    )?.dataset.fileKey ?? null
  );
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

test("diff panel places the layout switcher in the explorer footer", async () => {
  const panel = await renderPanel({
    colorScheme: "dark",
    diff: explorerDiff,
    layout: "split",
  });

  try {
    const explorerFooter = panel.mountNode.querySelector<HTMLElement>(
      ".ticket-workspace-diff-explorer-footer",
    );
    assert.ok(explorerFooter, "Expected explorer footer");
    assert.match(explorerFooter.textContent ?? "", /Split/);
    assert.match(explorerFooter.textContent ?? "", /Stacked/);

    const toolbar = panel.mountNode.querySelector<HTMLElement>(
      ".ticket-workspace-diff-toolbar",
    );
    assert.ok(toolbar, "Expected diff toolbar");
    assert.doesNotMatch(toolbar.textContent ?? "", /Stacked/);
  } finally {
    await panel.cleanup();
  }
});

test("diff panel restores a saved explorer width from local storage", async () => {
  const panel = await renderPanel({
    colorScheme: "dark",
    diff: explorerDiff,
    layout: "split",
    storage: {
      [diffExplorerSizeStorageKey]: "28",
    },
  });

  try {
    const diffPanel = panel.mountNode.querySelector<HTMLElement>(
      ".ticket-workspace-diff-panel",
    );
    assert.ok(diffPanel, "Expected diff panel container");
    assert.equal(
      diffPanel.style.getPropertyValue("--ticket-workspace-diff-explorer-size"),
      "28%",
    );
  } finally {
    await panel.cleanup();
  }
});

test("diff panel preserves the selected file position in the viewport when the layout changes", async () => {
  const originalRender = FileDiff.prototype.render;
  FileDiff.prototype.render = function renderWithViewportReset(props) {
    const renderResult = originalRender.call(this, props);
    const diffViewport = document.querySelector<HTMLElement>(
      ".ticket-workspace-diff-stage-scroll",
    );
    if (diffViewport) {
      diffViewport.scrollTop = 0;
    }

    return renderResult;
  };

  const panel = await renderPanel({
    colorScheme: "dark",
    diff: explorerDiff,
    layout: "split",
  });

  try {
    const diffViewport = panel.mountNode.querySelector<HTMLElement>(
      ".ticket-workspace-diff-stage-scroll",
    );
    assert.ok(diffViewport, "Expected diff viewport");

    const alphaFile = panel.mountNode.querySelector<HTMLElement>(
      '.ticket-workspace-diff-file[data-file-key="apps/web/src/components/MarkdownCodeEditor.test.ts"]',
    );
    const bravoFile = panel.mountNode.querySelector<HTMLElement>(
      '.ticket-workspace-diff-file[data-file-key="apps/web/src/components/MarkdownCodeEditor.tsx"]',
    );
    assert.ok(alphaFile, "Expected MarkdownCodeEditor.test.ts diff file");
    assert.ok(bravoFile, "Expected MarkdownCodeEditor.tsx diff file");

    Object.defineProperty(diffViewport, "scrollTop", {
      configurable: true,
      value: 500,
      writable: true,
    });
    Object.defineProperty(diffViewport, "clientHeight", {
      configurable: true,
      value: 500,
    });
    Object.defineProperty(diffViewport, "scrollHeight", {
      configurable: true,
      value: 4000,
    });
    diffViewport.scrollTo = ((options: ScrollToOptions) => {
      diffViewport.scrollTop = options.top ?? diffViewport.scrollTop;
    }) as typeof diffViewport.scrollTo;
    diffViewport.getBoundingClientRect = () =>
      ({
        bottom: 580,
        height: 500,
        left: 0,
        right: 0,
        top: 80,
        width: 0,
        x: 0,
        y: 80,
        toJSON: () => undefined,
      }) as DOMRect;

    const currentLayoutMode = () =>
      panel.mountNode.querySelector('[data-diff-type="split"]')
        ? "split"
        : "stacked";
    alphaFile.getBoundingClientRect = () =>
      ({
        bottom:
          80 +
          (currentLayoutMode() === "split" ? 400 : 320) -
          diffViewport.scrollTop +
          180,
        height: 180,
        left: 0,
        right: 0,
        top:
          80 +
          (currentLayoutMode() === "split" ? 400 : 320) -
          diffViewport.scrollTop,
        width: 0,
        x: 0,
        y:
          80 +
          (currentLayoutMode() === "split" ? 400 : 320) -
          diffViewport.scrollTop,
        toJSON: () => undefined,
      }) as DOMRect;
    bravoFile.getBoundingClientRect = () =>
      ({
        bottom:
          80 +
          (currentLayoutMode() === "split" ? 900 : 780) -
          diffViewport.scrollTop +
          220,
        height: 220,
        left: 0,
        right: 0,
        top:
          80 +
          (currentLayoutMode() === "split" ? 900 : 780) -
          diffViewport.scrollTop,
        width: 0,
        x: 0,
        y:
          80 +
          (currentLayoutMode() === "split" ? 900 : 780) -
          diffViewport.scrollTop,
        toJSON: () => undefined,
      }) as DOMRect;

    await clickTreeNode(
      panel.mountNode,
      "file:apps/web/src/components/MarkdownCodeEditor.tsx",
    );
    diffViewport.scrollTop = 500;
    const originalOffset =
      bravoFile.getBoundingClientRect().top -
      diffViewport.getBoundingClientRect().top;

    await panel.setLayout("stacked");
    const stackedOffset =
      bravoFile.getBoundingClientRect().top -
      diffViewport.getBoundingClientRect().top;
    assert.equal(stackedOffset, originalOffset);

    await panel.setLayout("split");
    const restoredOffset =
      bravoFile.getBoundingClientRect().top -
      diffViewport.getBoundingClientRect().top;
    assert.equal(restoredOffset, originalOffset);
  } finally {
    FileDiff.prototype.render = originalRender;
    await panel.cleanup();
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

test("diff panel retries when the embedded renderer mounts without diff lines", async () => {
  const originalRender = FileDiff.prototype.render;
  let renderCalls = 0;

  FileDiff.prototype.render = function renderWithInitialEmptyState(props) {
    renderCalls += 1;

    if (renderCalls === 1) {
      const fileContainer = props.fileContainer;
      assert.ok(fileContainer, "Expected file container for retry test");
      fileContainer.shadowRoot ?? fileContainer.attachShadow({ mode: "open" });
      this.fileContainer = fileContainer;
      this.options.onPostRender?.(fileContainer, this);
      return true;
    }

    return originalRender.call(this, props);
  };

  const harness = installDom();
  const root = createRoot(harness.mountNode);

  try {
    await act(async () => {
      root.render(
        <MantineProvider env="test" forceColorScheme="light">
          <TicketWorkspaceDiffPanel
            diff={sampleDiff}
            isLoading={false}
            layout="split"
            onLayoutChange={() => undefined}
          />
        </MantineProvider>,
      );
    });

    const renderer = await waitForElement(
      () => {
        const rendered = harness.mountNode.querySelector<HTMLElement>(
          ".ticket-workspace-diff-renderer diffs-container",
        );
        return rendered?.shadowRoot?.querySelector("[data-line]")
          ? rendered
          : null;
      },
      harness.flushAsyncWork,
      "Expected diff content to recover after an empty initial render",
    );

    assert.ok(renderer.shadowRoot);
    assert.match(renderer.shadowRoot.textContent ?? "", /const beta = "new";/);
    assert.ok(renderCalls >= 2, "Expected the panel to retry rendering");
  } finally {
    FileDiff.prototype.render = originalRender;
    await act(async () => {
      root.unmount();
    });
    harness.cleanup();
  }
});

test("diff panel groups changed files into a repo-style tree with folders before files", async () => {
  const panel = await renderPanel({
    colorScheme: "dark",
    diff: explorerDiff,
    layout: "split",
  });

  try {
    const nodeOrder = getTreeNodeOrder(panel.mountNode);
    assert.deepEqual(nodeOrder, [
      "dir:apps",
      "dir:apps/web",
      "dir:apps/web/src",
      "dir:apps/web/src/components",
      "file:apps/web/src/components/MarkdownCodeEditor.test.ts",
      "file:apps/web/src/components/MarkdownCodeEditor.tsx",
      "file:apps/web/src/app-shell.css",
      "file:apps/web/src/app-shell.test.ts",
    ]);
    assert.deepEqual(getRenderedDiffFileOrder(panel.mountNode), [
      "apps/web/src/components/MarkdownCodeEditor.test.ts",
      "apps/web/src/components/MarkdownCodeEditor.tsx",
      "apps/web/src/app-shell.css",
      "apps/web/src/app-shell.test.ts",
    ]);
  } finally {
    await panel.cleanup();
  }
});

test("diff panel activates files by scrolling only the diff viewport and marking the selected file", async () => {
  const panel = await renderPanel({
    colorScheme: "dark",
    diff: explorerDiff,
    layout: "stacked",
  });

  try {
    const diffViewport = panel.mountNode.querySelector<HTMLElement>(
      ".ticket-workspace-diff-stage-scroll",
    );
    assert.ok(diffViewport, "Expected diff viewport");

    let scrolledTop = Number.NaN;
    Object.defineProperty(diffViewport, "scrollTop", {
      configurable: true,
      value: 12,
      writable: true,
    });
    Object.defineProperty(diffViewport, "clientHeight", {
      configurable: true,
      value: 500,
    });
    Object.defineProperty(diffViewport, "scrollHeight", {
      configurable: true,
      value: 1000,
    });
    diffViewport.scrollTo = ((options: ScrollToOptions) => {
      scrolledTop = options.top ?? Number.NaN;
      diffViewport.scrollTop = options.top ?? diffViewport.scrollTop;
    }) as typeof diffViewport.scrollTo;

    const targetFile = panel.mountNode.querySelector<HTMLElement>(
      '.ticket-workspace-diff-file[data-file-key="apps/web/src/app-shell.css"]',
    );
    assert.ok(targetFile, "Expected app-shell.css diff file");
    targetFile.getBoundingClientRect = () =>
      ({
        bottom: 444,
        height: 24,
        left: 0,
        right: 0,
        top: 420,
        width: 0,
        x: 0,
        y: 420,
        toJSON: () => undefined,
      }) as DOMRect;
    diffViewport.getBoundingClientRect = () =>
      ({
        bottom: 580,
        height: 500,
        left: 0,
        right: 0,
        top: 80,
        width: 0,
        x: 0,
        y: 80,
        toJSON: () => undefined,
      }) as DOMRect;

    await clickTreeNode(panel.mountNode, "file:apps/web/src/app-shell.css");

    assert.equal(scrolledTop, 344);
    assert.equal(
      getSelectedDiffFile(panel.mountNode)?.dataset.fileKey,
      "apps/web/src/app-shell.css",
    );
  } finally {
    await panel.cleanup();
  }
});

test("diff panel preserves and reconciles tree selection across diff refreshes", async () => {
  const panel = await renderPanel({
    colorScheme: "light",
    diff: selectionBaseDiff,
    layout: "split",
  });

  try {
    await clickTreeNode(panel.mountNode, "file:src/bravo.ts");
    assert.equal(
      getSelectedDiffFile(panel.mountNode)?.dataset.fileKey,
      "src/bravo.ts",
    );

    await panel.rerender(selectionPreservedDiff);
    assert.equal(
      getSelectedDiffFile(panel.mountNode)?.dataset.fileKey,
      "src/bravo.ts",
    );

    await panel.rerender(selectionFallbackDiff);
    assert.equal(
      getSelectedDiffFile(panel.mountNode)?.dataset.fileKey,
      "src/charlie.ts",
    );
  } finally {
    await panel.cleanup();
  }
});

test("diff panel updates the tree selection to follow the file with the largest visible viewport overlap", async () => {
  const panel = await renderPanel({
    colorScheme: "dark",
    diff: selectionBaseDiff,
    layout: "split",
  });

  try {
    const diffViewport = panel.mountNode.querySelector<HTMLElement>(
      ".ticket-workspace-diff-stage-scroll",
    );
    assert.ok(diffViewport, "Expected diff viewport");

    Object.defineProperty(diffViewport, "scrollTop", {
      configurable: true,
      value: 0,
      writable: true,
    });
    diffViewport.getBoundingClientRect = () =>
      ({
        bottom: 620,
        height: 540,
        left: 0,
        right: 0,
        top: 80,
        width: 0,
        x: 0,
        y: 80,
        toJSON: () => undefined,
      }) as DOMRect;

    const alphaFile = panel.mountNode.querySelector<HTMLElement>(
      '.ticket-workspace-diff-file[data-file-key="src/alpha.ts"]',
    );
    const bravoFile = panel.mountNode.querySelector<HTMLElement>(
      '.ticket-workspace-diff-file[data-file-key="src/bravo.ts"]',
    );
    assert.ok(alphaFile, "Expected alpha diff file");
    assert.ok(bravoFile, "Expected bravo diff file");

    alphaFile.getBoundingClientRect = () =>
      ({
        bottom: 360,
        height: 220,
        left: 0,
        right: 0,
        top: 140,
        width: 0,
        x: 0,
        y: 140,
        toJSON: () => undefined,
      }) as DOMRect;
    bravoFile.getBoundingClientRect = () =>
      ({
        bottom: 660,
        height: 220,
        left: 0,
        right: 0,
        top: 440,
        width: 0,
        x: 0,
        y: 440,
        toJSON: () => undefined,
      }) as DOMRect;

    await panel.flushAsyncWork();
    assert.equal(getSelectedTreeFileKey(panel.mountNode), "src/alpha.ts");

    Object.defineProperty(diffViewport, "scrollTop", {
      configurable: true,
      value: 260,
      writable: true,
    });
    alphaFile.getBoundingClientRect = () =>
      ({
        bottom: 80,
        height: 220,
        left: 0,
        right: 0,
        top: -140,
        width: 0,
        x: 0,
        y: -140,
        toJSON: () => undefined,
      }) as DOMRect;
    bravoFile.getBoundingClientRect = () =>
      ({
        bottom: 360,
        height: 220,
        left: 0,
        right: 0,
        top: 140,
        width: 0,
        x: 0,
        y: 140,
        toJSON: () => undefined,
      }) as DOMRect;

    diffViewport.dispatchEvent(new window.Event("scroll"));
    await panel.flushAsyncWork();

    assert.equal(getSelectedTreeFileKey(panel.mountNode), "src/bravo.ts");
    assert.equal(
      getSelectedDiffFile(panel.mountNode)?.dataset.fileKey,
      "src/bravo.ts",
    );
  } finally {
    await panel.cleanup();
  }
});

test("diff panel keeps the clicked file selected when it occupies more of the viewport than the previous file", async () => {
  const panel = await renderPanel({
    colorScheme: "dark",
    diff: selectionBaseDiff,
    layout: "split",
  });

  try {
    const diffViewport = panel.mountNode.querySelector<HTMLElement>(
      ".ticket-workspace-diff-stage-scroll",
    );
    assert.ok(diffViewport, "Expected diff viewport");

    Object.defineProperty(diffViewport, "scrollTop", {
      configurable: true,
      value: 0,
      writable: true,
    });
    Object.defineProperty(diffViewport, "clientHeight", {
      configurable: true,
      value: 500,
    });
    Object.defineProperty(diffViewport, "scrollHeight", {
      configurable: true,
      value: 1000,
    });
    diffViewport.getBoundingClientRect = () =>
      ({
        bottom: 580,
        height: 500,
        left: 0,
        right: 0,
        top: 80,
        width: 0,
        x: 0,
        y: 80,
        toJSON: () => undefined,
      }) as DOMRect;

    const alphaFile = panel.mountNode.querySelector<HTMLElement>(
      '.ticket-workspace-diff-file[data-file-key="src/alpha.ts"]',
    );
    const bravoFile = panel.mountNode.querySelector<HTMLElement>(
      '.ticket-workspace-diff-file[data-file-key="src/bravo.ts"]',
    );
    assert.ok(alphaFile, "Expected alpha diff file");
    assert.ok(bravoFile, "Expected bravo diff file");

    alphaFile.getBoundingClientRect = () =>
      ({
        bottom: 120,
        height: 500,
        left: 0,
        right: 0,
        top: -380,
        width: 0,
        x: 0,
        y: -380,
        toJSON: () => undefined,
      }) as DOMRect;
    bravoFile.getBoundingClientRect = () =>
      ({
        bottom: 430,
        height: 300,
        left: 0,
        right: 0,
        top: 130,
        width: 0,
        x: 0,
        y: 130,
        toJSON: () => undefined,
      }) as DOMRect;
    diffViewport.scrollTo = ((options: ScrollToOptions) => {
      diffViewport.scrollTop = options.top ?? diffViewport.scrollTop;
    }) as typeof diffViewport.scrollTo;

    await clickTreeNode(panel.mountNode, "file:src/bravo.ts");
    diffViewport.dispatchEvent(new window.Event("scroll"));
    await panel.flushAsyncWork();

    assert.equal(getSelectedTreeFileKey(panel.mountNode), "src/bravo.ts");
    assert.equal(
      getSelectedDiffFile(panel.mountNode)?.dataset.fileKey,
      "src/bravo.ts",
    );
  } finally {
    await panel.cleanup();
  }
});

test("diff panel persists explorer width changes when dragging the sash", async () => {
  const panel = await renderPanel({
    colorScheme: "dark",
    diff: explorerDiff,
    layout: "split",
  });

  try {
    const diffPanel = panel.mountNode.querySelector<HTMLElement>(
      ".ticket-workspace-diff-panel",
    );
    const sash = panel.mountNode.querySelector<HTMLElement>(
      ".ticket-workspace-diff-sash",
    );
    assert.ok(diffPanel, "Expected diff panel");
    assert.ok(sash, "Expected explorer resize sash");

    diffPanel.getBoundingClientRect = () =>
      ({
        bottom: 700,
        height: 500,
        left: 100,
        right: 1100,
        top: 200,
        width: 1000,
        x: 100,
        y: 200,
        toJSON: () => undefined,
      }) as DOMRect;

    await act(async () => {
      sash.dispatchEvent(
        new window.MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          clientX: 320,
        }),
      );
      window.dispatchEvent(
        new window.MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          clientX: 350,
        }),
      );
      window.dispatchEvent(
        new window.MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    assert.equal(
      diffPanel.style.getPropertyValue("--ticket-workspace-diff-explorer-size"),
      "25%",
    );
    assert.equal(window.localStorage.getItem(diffExplorerSizeStorageKey), "25");
  } finally {
    await panel.cleanup();
  }
});
