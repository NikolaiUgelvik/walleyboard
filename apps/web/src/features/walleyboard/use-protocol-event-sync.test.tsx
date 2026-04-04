import assert from "node:assert/strict";
import test from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type {
  ProtocolEvent,
  ReviewRun,
} from "../../../../../packages/contracts/src/index.js";

import { useProtocolEventSync } from "./use-protocol-event-sync.js";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

class FakeSocket {
  readonly #listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  disconnect(): void {}

  emitServer(event: string, payload: unknown): void {
    for (const listener of this.#listeners.get(event) ?? []) {
      listener(payload);
    }
  }

  on(event: string, listener: (...args: unknown[]) => void): this {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
    return this;
  }
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

function installDom(socketFactory: () => FakeSocket) {
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
    installGlobal("__WALLEYBOARD_SOCKET_IO_FACTORY__", socketFactory),
  ];

  return () => {
    for (const restore of restoreGlobals.reverse()) {
      restore();
    }
    dom.window.close();
  };
}

function SyncProbe({ queryClient }: { queryClient: QueryClient }) {
  useProtocolEventSync({
    queryClient,
    selectedDraftId: null,
    selectedProjectId: null,
    selectedSessionId: null,
    setInspectorState() {},
  });

  return null;
}

test("review_run.updated hydrates the latest review-run cache without polling", async () => {
  const sockets: FakeSocket[] = [];
  const restoreDom = installDom(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });
  const container = document.createElement("div");
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SyncProbe queryClient={queryClient} />
        </QueryClientProvider>,
      );
    });

    const reviewRun: ReviewRun = {
      id: "review-run-31",
      ticket_id: 31,
      review_package_id: "review-package-31",
      implementation_session_id: "session-31",
      status: "running",
      adapter_session_ref: null,
      prompt: "Review ticket 31.",
      report: null,
      failure_message: null,
      created_at: "2026-04-04T00:00:00.000Z",
      updated_at: "2026-04-04T00:00:00.000Z",
      completed_at: null,
    };
    const protocolEvent: ProtocolEvent = {
      entity_id: reviewRun.id,
      entity_type: "review_run",
      event_id: "event-31",
      event_type: "review_run.updated",
      occurred_at: "2026-04-04T00:00:00.000Z",
      payload: {
        review_run: reviewRun,
      },
    };

    await act(async () => {
      sockets[0]?.emitServer("protocol.event", protocolEvent);
    });

    assert.deepEqual(queryClient.getQueryData(["tickets", 31, "review-run"]), {
      review_run: reviewRun,
    });
  } finally {
    await act(async () => {
      root.unmount();
    });
    restoreDom();
  }
});
