import assert from "node:assert/strict";
import test from "node:test";

import { MantineProvider } from "@mantine/core";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { SessionInspectorSection } from "./inspector-pane-sections.js";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

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

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
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
    installGlobal("ShadowRoot", window.ShadowRoot),
    installGlobal("SVGElement", window.SVGElement),
  ];
  const mountNode = window.document.createElement("div");
  window.document.body.appendChild(mountNode);

  return {
    cleanup: () => {
      mountNode.remove();
      for (const restoreGlobal of restoreGlobals.reverse()) {
        restoreGlobal();
      }
      dom.window.close();
    },
    mountNode,
  };
}

test("SessionInspectorSection shows loading while the session query is pending", async () => {
  const dom = installDom();
  const root = createRoot(dom.mountNode);

  try {
    const controller = {
      selectedSessionId: "session-1",
      selectedSessionTicket: null,
      session: null,
      sessionLogsQuery: {
        isPending: true,
      },
      sessionQuery: {
        error: null,
        isError: false,
        isPending: true,
      },
    };

    await act(async () => {
      root.render(
        <MantineProvider>
          <SessionInspectorSection
            activitySummary={null}
            controller={controller as never}
          />
        </MantineProvider>,
      );
    });

    assert.match(
      dom.mountNode.textContent ?? "",
      /Loading the current ticket session\./,
    );
    assert.doesNotMatch(
      dom.mountNode.textContent ?? "",
      /Session details are not available yet\./,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.cleanup();
  }
});

test("SessionInspectorSection shows the session error when loading fails", async () => {
  const dom = installDom();
  const root = createRoot(dom.mountNode);

  try {
    const controller = {
      selectedSessionId: "session-1",
      selectedSessionTicket: null,
      session: null,
      sessionLogsQuery: {
        isPending: false,
      },
      sessionQuery: {
        error: new Error("Session failed to load"),
        isError: true,
        isPending: false,
      },
    };

    await act(async () => {
      root.render(
        <MantineProvider>
          <SessionInspectorSection
            activitySummary={null}
            controller={controller as never}
          />
        </MantineProvider>,
      );
    });

    assert.match(dom.mountNode.textContent ?? "", /Session failed to load/);
    assert.doesNotMatch(
      dom.mountNode.textContent ?? "",
      /Session details are not available yet\./,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.cleanup();
  }
});
