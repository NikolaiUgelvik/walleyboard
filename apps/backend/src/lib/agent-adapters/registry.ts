import type { AgentAdapter } from "../../../../../packages/contracts/src/index.js";
import type { AgentCliAdapter } from "./types.js";

export class AgentAdapterRegistry {
  readonly #adapters = new Map<AgentAdapter, AgentCliAdapter>();

  constructor(adapters: AgentCliAdapter[]) {
    for (const adapter of adapters) {
      this.#adapters.set(adapter.id, adapter);
    }
  }

  get(adapterId: AgentAdapter): AgentCliAdapter {
    const adapter = this.#adapters.get(adapterId);
    if (!adapter) {
      throw new Error(`Unsupported agent adapter: ${adapterId}`);
    }

    return adapter;
  }
}
