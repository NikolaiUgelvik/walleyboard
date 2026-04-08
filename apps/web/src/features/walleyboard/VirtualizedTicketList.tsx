import { useCallback, useEffect, useRef, useState } from "react";
import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

import { ESTIMATED_CARD_HEIGHT, TicketCard } from "./TicketCard.js";
import type { BoardViewController } from "./walleyboard-view-state.js";

export {
  projectAccentButtonClassName,
  TicketWorkspaceActions,
} from "./TicketCard.js";

const HAS_INTERSECTION_OBSERVER =
  typeof globalThis !== "undefined" &&
  typeof globalThis.IntersectionObserver !== "undefined";

export function VirtualizedTicketList({
  tickets,
  column,
  controller,
  onVisibleTicketIdsChange,
  scrollRoot,
}: {
  tickets: TicketFrontmatter[];
  column: string;
  controller: BoardViewController;
  onVisibleTicketIdsChange: (column: string, visibleIds: Set<number>) => void;
  scrollRoot?: Element | null;
}) {
  const [visibleSet, setVisibleSet] = useState<Set<number>>(
    () => new Set(tickets.map((t) => t.id)),
  );
  const sentinelRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const heightCache = useRef<Map<number, number>>(new Map());
  const sentinelCallbackCache = useRef(
    new Map<number, (el: HTMLDivElement | null) => void>(),
  );
  const measureCallbackCache = useRef(
    new Map<number, (el: HTMLDivElement | null) => void>(),
  );
  const observerRef = useRef<IntersectionObserver | null>(null);
  const onChangeRef = useRef(onVisibleTicketIdsChange);
  onChangeRef.current = onVisibleTicketIdsChange;

  useEffect(() => {
    if (!HAS_INTERSECTION_OBSERVER) return;

    const observerOptions: IntersectionObserverInit = {
      rootMargin: "200px 0px",
    };
    if (scrollRoot) {
      observerOptions.root = scrollRoot;
    }

    const observer = new IntersectionObserver((entries) => {
      setVisibleSet((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const entry of entries) {
          const ticketId = Number(
            (entry.target as HTMLElement).dataset.ticketVirtual,
          );
          if (Number.isNaN(ticketId)) continue;
          if (entry.isIntersecting) {
            if (!next.has(ticketId)) {
              next.add(ticketId);
              changed = true;
            }
          } else {
            if (next.has(ticketId)) {
              next.delete(ticketId);
              changed = true;
            }
          }
        }
        return changed ? next : prev;
      });
    }, observerOptions);
    observerRef.current = observer;

    for (const [, element] of sentinelRefs.current) {
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [scrollRoot]);

  useEffect(() => {
    const currentIds = new Set(tickets.map((t) => t.id));

    for (const id of sentinelCallbackCache.current.keys()) {
      if (!currentIds.has(id)) {
        sentinelCallbackCache.current.delete(id);
        measureCallbackCache.current.delete(id);
        heightCache.current.delete(id);
      }
    }

    setVisibleSet((prev) => {
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (currentIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      for (const id of currentIds) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tickets]);

  useEffect(() => {
    onChangeRef.current(column, visibleSet);
  }, [column, visibleSet]);

  useEffect(() => {
    return () => {
      onChangeRef.current(column, new Set());
    };
  }, [column]);

  const registerSentinel = useCallback(
    (ticketId: number, element: HTMLDivElement | null) => {
      const prev = sentinelRefs.current.get(ticketId);
      if (prev === element) return;

      if (prev) {
        observerRef.current?.unobserve(prev);
        sentinelRefs.current.delete(ticketId);
      }
      if (element) {
        sentinelRefs.current.set(ticketId, element);
        observerRef.current?.observe(element);
      }
    },
    [],
  );

  const measureRef = useCallback(
    (ticketId: number, element: HTMLDivElement | null) => {
      if (element) {
        heightCache.current.set(ticketId, element.offsetHeight);
      }
    },
    [],
  );

  const getSentinelRef = useCallback(
    (ticketId: number) => {
      let cb = sentinelCallbackCache.current.get(ticketId);
      if (!cb) {
        cb = (el: HTMLDivElement | null) => registerSentinel(ticketId, el);
        sentinelCallbackCache.current.set(ticketId, cb);
      }
      return cb;
    },
    [registerSentinel],
  );

  const getMeasureRef = useCallback(
    (ticketId: number) => {
      let cb = measureCallbackCache.current.get(ticketId);
      if (!cb) {
        cb = (el: HTMLDivElement | null) => measureRef(ticketId, el);
        measureCallbackCache.current.set(ticketId, cb);
      }
      return cb;
    },
    [measureRef],
  );

  if (!HAS_INTERSECTION_OBSERVER) {
    return (
      <>
        {tickets.map((ticket) => (
          <div key={ticket.id} id={`ticket-${ticket.id}`} tabIndex={-1}>
            <TicketCard
              controller={controller}
              ticket={ticket}
              column={column}
            />
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      {tickets.map((ticket) => {
        const isVisible = visibleSet.has(ticket.id);
        const cachedHeight =
          heightCache.current.get(ticket.id) ?? ESTIMATED_CARD_HEIGHT;

        return (
          <div
            key={ticket.id}
            id={`ticket-${ticket.id}`}
            tabIndex={-1}
            data-ticket-virtual={ticket.id}
            ref={getSentinelRef(ticket.id)}
            style={isVisible ? undefined : { minHeight: cachedHeight }}
          >
            {isVisible ? (
              <div ref={getMeasureRef(ticket.id)}>
                <TicketCard
                  controller={controller}
                  ticket={ticket}
                  column={column}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
