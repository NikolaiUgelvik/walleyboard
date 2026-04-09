import { useQueries } from "@tanstack/react-query";
import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";
import { fetchJson } from "./shared-api.js";
import type { SessionResponse } from "./shared-types.js";

export function useGlobalSessionSummaries(globalTickets: TicketFrontmatter[]) {
  return useQueries({
    queries: globalTickets
      .filter(
        (
          ticket,
        ): ticket is TicketFrontmatter & {
          session_id: string;
        } => ticket.session_id !== null,
      )
      .map((ticket) => ({
        queryKey: ["sessions", ticket.session_id],
        queryFn: () =>
          fetchJson<SessionResponse>(`/sessions/${ticket.session_id}`),
      })),
  });
}
