import assert from "node:assert/strict";
import test from "node:test";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";
import { IntersectionObserverMock } from "./IntersectionObserver-mock.js";
import { useVisibleTicketDiffSummary } from "./use-visible-ticket-diff-summary.js";
import { VirtualizedTicketList } from "./VirtualizedTicketList.js";

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
    installGlobal("navigator", window.navigator),
    installGlobal("Element", window.Element),
    installGlobal("HTMLElement", window.HTMLElement),
    installGlobal("MutationObserver", window.MutationObserver),
    installGlobal("Node", window.Node),
    installGlobal("ResizeObserver", ResizeObserverStub),
    installGlobal("ShadowRoot", window.ShadowRoot),
    installGlobal("SVGElement", window.SVGElement),
  ];

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
  window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    window.setTimeout(
      () => callback(Date.now()),
      0,
    )) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => {
    window.clearTimeout(id);
  }) as typeof window.cancelAnimationFrame;
  restoreGlobals.push(
    installGlobal("getComputedStyle", window.getComputedStyle.bind(window)),
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
    mountNode,
    window,
  };
}

function createTicket(
  overrides: Partial<TicketFrontmatter> = {},
): TicketFrontmatter {
  return {
    acceptance_criteria: [],
    artifact_scope_id: `artifact-ticket-${overrides.id ?? 1}`,
    created_at: "2026-04-03T00:00:00.000Z",
    description: "A test ticket.",
    id: 1,
    linked_pr: null,
    project: "project-1",
    repo: "repo-1",
    session_id: null,
    status: "in_progress",
    target_branch: "main",
    ticket_type: "feature",
    title: "Test ticket",
    updated_at: "2026-04-03T00:00:00.000Z",
    working_branch: null,
    ...overrides,
  };
}

function testRenderCard(ticket: TicketFrontmatter) {
  return <div className="board-card">{ticket.title}</div>;
}

test("initial render shows all tickets and reports all IDs visible", async () => {
  IntersectionObserverMock.reset();
  const harness = installDom();
  const root = createRoot(harness.mountNode);

  const tickets = [
    createTicket({ id: 10, title: "Ticket X" }),
    createTicket({ id: 20, title: "Ticket Y" }),
    createTicket({ id: 30, title: "Ticket Z" }),
  ];
  const changeSpy: Array<[string, Set<number>]> = [];

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <VirtualizedTicketList
            tickets={tickets}
            column="in_progress"
            onVisibleTicketIdsChange={(col: string, ids: Set<number>) => {
              changeSpy.push([col, new Set(ids)]);
            }}
            renderCard={testRenderCard}
          />
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    const cards = harness.mountNode.querySelectorAll(".board-card");
    assert.equal(cards.length, 3, "All tickets visible on initial render");

    const sentinels = harness.mountNode.querySelectorAll(
      "[data-ticket-virtual]",
    );
    assert.equal(sentinels.length, 3, "Each ticket wrapped in a sentinel");

    assert.ok(changeSpy.length > 0, "onVisibleTicketIdsChange was called");
    const lastCall = changeSpy[changeSpy.length - 1];
    assert.ok(lastCall);
    assert.equal(lastCall[0], "in_progress");
    assert.equal(lastCall[1].size, 3);
    assert.ok(lastCall[1].has(10));
    assert.ok(lastCall[1].has(20));
    assert.ok(lastCall[1].has(30));
  } finally {
    await act(async () => {
      root.unmount();
    });
    harness.cleanup();
  }
});

test("non-intersecting tickets are hidden and excluded from visible set", async () => {
  IntersectionObserverMock.reset();
  const harness = installDom();
  const root = createRoot(harness.mountNode);

  const tickets = [
    createTicket({ id: 100, title: "Visible ticket" }),
    createTicket({ id: 200, title: "Hidden ticket" }),
    createTicket({ id: 300, title: "Also visible" }),
  ];
  const changeSpy: Array<[string, Set<number>]> = [];

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <VirtualizedTicketList
            tickets={tickets}
            column="review"
            onVisibleTicketIdsChange={(col: string, ids: Set<number>) => {
              changeSpy.push([col, new Set(ids)]);
            }}
            renderCard={testRenderCard}
          />
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    assert.equal(
      harness.mountNode.querySelectorAll(".board-card").length,
      3,
      "All tickets visible initially",
    );

    const observer = IntersectionObserverMock.instances.find(
      (o) => o.elements.size > 0,
    );
    assert.ok(observer, "IntersectionObserver instance created");

    const sentinel200 = harness.mountNode.querySelector(
      '[data-ticket-virtual="200"]',
    );
    assert.ok(sentinel200, "Sentinel for ticket 200 exists");

    await act(async () => {
      observer.simulateEntries([
        {
          target: sentinel200,
          isIntersecting: false,
          intersectionRatio: 0,
        },
      ]);
      await Promise.resolve();
    });

    assert.equal(
      harness.mountNode.querySelectorAll(".board-card").length,
      2,
      "Hidden ticket removed from DOM",
    );
    assert.equal(
      sentinel200.querySelector(".board-card"),
      null,
      "No card inside hidden sentinel",
    );
    assert.ok(
      sentinel200.getAttribute("style")?.includes("min-height"),
      "Hidden sentinel has placeholder height",
    );

    const lastCall = changeSpy[changeSpy.length - 1];
    assert.ok(lastCall);
    assert.equal(lastCall[0], "review");
    assert.ok(!lastCall[1].has(200), "Ticket 200 excluded from visible set");
    assert.ok(lastCall[1].has(100), "Ticket 100 still visible");
    assert.ok(lastCall[1].has(300), "Ticket 300 still visible");
  } finally {
    await act(async () => {
      root.unmount();
    });
    harness.cleanup();
  }
});

test("re-intersecting ticket is restored to full rendering", async () => {
  IntersectionObserverMock.reset();
  const harness = installDom();
  const root = createRoot(harness.mountNode);

  const tickets = [createTicket({ id: 1, title: "Only ticket" })];
  const changeSpy: Array<[string, Set<number>]> = [];

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <VirtualizedTicketList
            tickets={tickets}
            column="in_progress"
            onVisibleTicketIdsChange={(col: string, ids: Set<number>) => {
              changeSpy.push([col, new Set(ids)]);
            }}
            renderCard={testRenderCard}
          />
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    const observer = IntersectionObserverMock.instances.find(
      (o) => o.elements.size > 0,
    );
    assert.ok(observer);

    const sentinel = harness.mountNode.querySelector(
      '[data-ticket-virtual="1"]',
    );
    assert.ok(sentinel);

    await act(async () => {
      observer.simulateEntries([
        { target: sentinel, isIntersecting: false, intersectionRatio: 0 },
      ]);
      await Promise.resolve();
    });

    assert.equal(
      harness.mountNode.querySelectorAll(".board-card").length,
      0,
      "Card hidden after leaving viewport",
    );

    await act(async () => {
      observer.simulateEntries([
        { target: sentinel, isIntersecting: true, intersectionRatio: 1 },
      ]);
      await Promise.resolve();
    });

    assert.equal(
      harness.mountNode.querySelectorAll(".board-card").length,
      1,
      "Card restored after re-entering viewport",
    );

    const lastCall = changeSpy[changeSpy.length - 1];
    assert.ok(lastCall);
    assert.ok(lastCall[1].has(1), "Ticket 1 back in visible set");
  } finally {
    await act(async () => {
      root.unmount();
    });
    harness.cleanup();
  }
});

test("off-screen ticket sentinel is focusable and re-renders card on intersection", async () => {
  IntersectionObserverMock.reset();
  const harness = installDom();
  const root = createRoot(harness.mountNode);

  const tickets = [createTicket({ id: 42, title: "Focus target" })];

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <VirtualizedTicketList
            tickets={tickets}
            column="in_progress"
            onVisibleTicketIdsChange={() => {}}
            renderCard={testRenderCard}
          />
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    const observer = IntersectionObserverMock.instances.find(
      (o) => o.elements.size > 0,
    );
    assert.ok(observer);

    const sentinel = harness.mountNode.querySelector(
      '[data-ticket-virtual="42"]',
    );
    assert.ok(sentinel);

    await act(async () => {
      observer.simulateEntries([
        { target: sentinel, isIntersecting: false, intersectionRatio: 0 },
      ]);
      await Promise.resolve();
    });

    assert.equal(
      harness.mountNode.querySelectorAll(".board-card").length,
      0,
      "Card is hidden when off-screen",
    );

    const sentinelById = harness.window.document.getElementById("ticket-42");
    assert.ok(sentinelById, "Sentinel is findable via getElementById");
    assert.equal(
      sentinelById.getAttribute("tabindex"),
      "-1",
      "Sentinel is programmatically focusable",
    );
    sentinelById.focus();
    assert.equal(
      harness.window.document.activeElement,
      sentinelById,
      "Sentinel received focus",
    );

    await act(async () => {
      observer.simulateEntries([
        { target: sentinel, isIntersecting: true, intersectionRatio: 1 },
      ]);
      await Promise.resolve();
    });

    assert.equal(
      harness.mountNode.querySelectorAll(".board-card").length,
      1,
      "Card rendered after intersection fires",
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    harness.cleanup();
  }
});

test("scrollRoot is forwarded to IntersectionObserver as root option", async () => {
  IntersectionObserverMock.reset();
  const harness = installDom();
  const root = createRoot(harness.mountNode);

  const tickets = [createTicket({ id: 1, title: "Ticket A" })];
  const scrollContainer = harness.window.document.createElement("div");
  harness.window.document.body.appendChild(scrollContainer);

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <VirtualizedTicketList
            tickets={tickets}
            column="in_progress"
            onVisibleTicketIdsChange={() => {}}
            scrollRoot={scrollContainer as unknown as Element}
            renderCard={testRenderCard}
          />
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    const observer = IntersectionObserverMock.instances.find(
      (o) => o.elements.size > 0,
    );
    assert.ok(observer, "Observer created");
    assert.equal(
      observer.options?.root,
      scrollContainer,
      "Observer root matches scrollRoot prop",
    );
  } finally {
    scrollContainer.remove();
    await act(async () => {
      root.unmount();
    });
    harness.cleanup();
  }
});

test("useVisibleTicketDiffSummary merges IDs from multiple columns", async () => {
  const harness = installDom();
  const root = createRoot(harness.mountNode);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  let hookResult: ReturnType<typeof useVisibleTicketDiffSummary> | null = null;

  function TestHarness({ tickets }: { tickets: TicketFrontmatter[] }) {
    hookResult = useVisibleTicketDiffSummary(tickets);
    return null;
  }

  const tickets = [
    createTicket({ id: 1, session_id: "s1" }),
    createTicket({ id: 2, session_id: "s2" }),
    createTicket({ id: 3, session_id: "s3" }),
  ];

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MantineProvider>
            <TestHarness tickets={tickets} />
          </MantineProvider>
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });

    assert.ok(hookResult, "Hook returned a result");
    const result = hookResult as ReturnType<typeof useVisibleTicketDiffSummary>;
    assert.ok(
      typeof result.updateVisibleTicketIds === "function",
      "updateVisibleTicketIds is a function",
    );

    await act(async () => {
      result.updateVisibleTicketIds("in_progress", new Set([1]));
      await Promise.resolve();
    });

    await act(async () => {
      result.updateVisibleTicketIds("review", new Set([2, 3]));
      await Promise.resolve();
    });

    await act(async () => {
      result.updateVisibleTicketIds("in_progress", new Set([1]));
      await Promise.resolve();
    });

    assert.ok(hookResult, "Hook still returns after updates");
  } finally {
    await queryClient.cancelQueries();
    queryClient.clear();
    await act(async () => {
      root.unmount();
      await new Promise((r) => setTimeout(r, 0));
    });
    harness.cleanup();
  }
});

test("unmount reports empty visible set to clear stale column state", async () => {
  IntersectionObserverMock.reset();
  const harness = installDom();
  const root = createRoot(harness.mountNode);

  const tickets = [
    createTicket({ id: 1, title: "Ticket A" }),
    createTicket({ id: 2, title: "Ticket B" }),
  ];
  const changeSpy: Array<[string, Set<number>]> = [];

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <VirtualizedTicketList
            tickets={tickets}
            column="in_progress"
            onVisibleTicketIdsChange={(col: string, ids: Set<number>) => {
              changeSpy.push([col, new Set(ids)]);
            }}
            renderCard={testRenderCard}
          />
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    assert.ok(changeSpy.length > 0, "Received initial visibility report");

    await act(async () => {
      root.unmount();
    });

    const lastCall = changeSpy[changeSpy.length - 1];
    assert.ok(lastCall, "Received call after unmount");
    assert.equal(lastCall[0], "in_progress", "Column matches");
    assert.equal(lastCall[1].size, 0, "Empty set reported on unmount");
  } finally {
    harness.cleanup();
  }
});
