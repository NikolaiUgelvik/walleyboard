import { nanoid } from "nanoid";
import type {
  EventEntityType,
  EventType,
  ProtocolEvent,
} from "../../../../packages/contracts/src/index.js";

import { nowIso } from "./time.js";

type Listener = (event: ProtocolEvent) => void;

export class EventHub {
  readonly #listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  }

  publish(event: ProtocolEvent): void {
    for (const listener of this.#listeners) {
      listener(event);
    }
  }
}

export function makeProtocolEvent(
  eventType: EventType,
  entityType: EventEntityType,
  entityId: string,
  payload: Record<string, unknown>,
): ProtocolEvent {
  return {
    event_id: nanoid(),
    event_type: eventType,
    occurred_at: nowIso(),
    entity_type: entityType,
    entity_id: entityId,
    payload,
  };
}
