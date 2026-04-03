import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

export type SessionSummaryState = {
  error: string | null;
  isError: boolean;
  isPending: boolean;
};

export function buildSessionSummaryStateById(input: {
  sessionSummaries: Array<{
    error: { message: string } | null;
    isError: boolean;
    isPending: boolean;
  }>;
  tickets: TicketFrontmatter[];
}) {
  return new Map(
    input.tickets
      .filter(
        (
          ticket,
        ): ticket is TicketFrontmatter & {
          session_id: string;
        } => ticket.session_id !== null,
      )
      .map((ticket, index) => {
        const query = input.sessionSummaries[index];

        return [
          ticket.session_id,
          {
            error: query?.isError
              ? (query.error?.message ?? "Unable to load session details")
              : null,
            isError: query?.isError ?? false,
            isPending: query?.isPending ?? false,
          },
        ] as const;
      }),
  );
}
