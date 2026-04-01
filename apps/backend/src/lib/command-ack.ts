import { nanoid } from "nanoid";
import type { CommandAck } from "../../../../packages/contracts/src/index.js";

import { nowIso } from "./time.js";

type ResourceRefs = CommandAck["resource_refs"];

export function makeCommandAck(
  accepted: boolean,
  message: string | null,
  resourceRefs: ResourceRefs = {},
): CommandAck {
  return {
    accepted,
    command_id: nanoid(),
    issued_at: nowIso(),
    resource_refs: resourceRefs,
    message,
  };
}
