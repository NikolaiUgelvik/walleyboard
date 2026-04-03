import assert from "node:assert/strict";
import test from "node:test";

import { MantineProvider } from "@mantine/core";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AgentAdapterIcon,
  AgentAdapterOptionLabel,
  agentAdapterOptions,
  getAgentAdapterIconPath,
  getProjectAgentAdapterOptions,
  ProjectAgentAdapterSelect,
} from "./shared.js";

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
    cleanup: () => {
      mountNode.remove();
      for (const restore of restoreGlobals.reverse()) {
        restore();
      }
      dom.window.close();
    },
    flushAsyncWork: () => flushAsyncWork(pendingCallbacks),
    mountNode,
    window,
  };
}

test("AgentAdapter icon helpers point to the local SVG assets", () => {
  assert.equal(getAgentAdapterIconPath("codex"), "/agent-icons/codex.svg");
  assert.equal(
    getAgentAdapterIconPath("claude-code"),
    "/agent-icons/claude-code.svg",
  );

  const iconMarkup = renderToStaticMarkup(
    <MantineProvider>
      <AgentAdapterIcon adapter="codex" />
      <AgentAdapterIcon adapter="claude-code" />
    </MantineProvider>,
  );

  assert.match(iconMarkup, /\/agent-icons\/codex\.svg/);
  assert.match(iconMarkup, /\/agent-icons\/claude-code\.svg/);
});

test("AgentAdapter option label renders the matching icon without changing text", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <AgentAdapterOptionLabel adapter="codex" label="Codex" />
      <AgentAdapterOptionLabel adapter="claude-code" label="Claude Code" />
    </MantineProvider>,
  );

  assert.match(markup, /Codex/);
  assert.match(markup, /Claude Code/);
  assert.match(markup, /\/agent-icons\/codex\.svg/);
  assert.match(markup, /\/agent-icons\/claude-code\.svg/);
});

test("Project Agent CLI options keep the existing disabled Claude label behavior", () => {
  assert.deepEqual(getProjectAgentAdapterOptions(true), agentAdapterOptions);
  assert.deepEqual(getProjectAgentAdapterOptions(false), [
    { label: "Codex", value: "codex" },
    {
      label: "Claude Code (not installed)",
      value: "claude-code",
      disabled: true,
    },
  ]);
});

test("ProjectAgentAdapterSelect shows the selected icon and renders per-option icons in the dropdown", async () => {
  const harness = installDom();
  const root = createRoot(harness.mountNode);

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <ProjectAgentAdapterSelect
            claudeCodeAvailable={false}
            value="codex"
            onChange={() => {}}
          />
        </MantineProvider>,
      );
      await Promise.resolve();
    });
    await harness.flushAsyncWork();

    const input = harness.mountNode.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    assert.ok(input);
    assert.equal(input.getAttribute("value"), "Codex");

    const selectedIcon = harness.mountNode.querySelector<HTMLImageElement>(
      '[data-position="left"] img',
    );
    assert.ok(selectedIcon);
    assert.equal(selectedIcon.getAttribute("src"), "/agent-icons/codex.svg");

    await act(async () => {
      input.dispatchEvent(
        new harness.window.MouseEvent("mousedown", {
          bubbles: true,
        }),
      );
      input.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
      await Promise.resolve();
    });
    await harness.flushAsyncWork();

    const options = Array.from(
      harness.window.document.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    assert.equal(options.length, 2);

    const codexOption = options.find(
      (option) => option.textContent === "Codex",
    );
    assert.ok(codexOption);
    assert.equal(
      codexOption.querySelector("img")?.getAttribute("src"),
      "/agent-icons/codex.svg",
    );

    const claudeOption = options.find(
      (option) => option.textContent === "Claude Code (not installed)",
    );
    assert.ok(claudeOption);
    assert.equal(
      claudeOption.querySelector("img")?.getAttribute("src"),
      "/agent-icons/claude-code.svg",
    );
    assert.equal(claudeOption.getAttribute("data-combobox-disabled"), "true");

    await act(async () => {
      root.render(
        <MantineProvider>
          <ProjectAgentAdapterSelect
            claudeCodeAvailable
            value="claude-code"
            onChange={() => {}}
          />
        </MantineProvider>,
      );
      await Promise.resolve();
    });
    await harness.flushAsyncWork();

    const updatedInput = harness.mountNode.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    assert.ok(updatedInput);
    assert.equal(updatedInput.getAttribute("value"), "Claude Code");

    const updatedSelectedIcon =
      harness.mountNode.querySelector<HTMLImageElement>(
        '[data-position="left"] img',
      );
    assert.ok(updatedSelectedIcon);
    assert.equal(
      updatedSelectedIcon.getAttribute("src"),
      "/agent-icons/claude-code.svg",
    );
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    await harness.flushAsyncWork();
    harness.cleanup();
  }
});
