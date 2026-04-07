import { Badge, Box, Stack, Text } from "@mantine/core";

import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";
import { MarkdownContent } from "../../components/MarkdownContent.js";
import { SectionCard } from "../../components/SectionCard.js";
import { MarkdownListItems } from "./shared.js";
import { humanizeTicketStatus, ticketStatusColor } from "./shared-utils.js";

export function TicketDetailPane({
  navigateToTicketReference,
  repositories,
  ticket,
}: {
  navigateToTicketReference: (ticketId: number) => void;
  repositories: Array<{ id: string; name: string }>;
  ticket: TicketFrontmatter;
}): React.JSX.Element {
  return (
    <SectionCard>
      <Stack gap="md">
        <Box style={{ fontWeight: 700 }}>
          <Text component="span" inherit>
            #{ticket.id}{" "}
          </Text>
          <MarkdownContent
            content={ticket.title}
            inline
            onTicketReferenceNavigate={navigateToTicketReference}
            ticketReferences={ticket.ticket_references ?? []}
          />
        </Box>

        <Box className="detail-meta-grid">
          <Box className="detail-meta-card">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Repository
            </Text>
            <Text fw={700}>
              {repositories.find((r) => r.id === ticket.repo)?.name ??
                "Pending"}
            </Text>
          </Box>
          <Box className="detail-meta-card">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Type
            </Text>
            <Text fw={700}>
              {ticket.ticket_type.charAt(0).toUpperCase() +
                ticket.ticket_type.slice(1)}
            </Text>
          </Box>
          <Box className="detail-meta-card">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Status
            </Text>
            <Badge
              variant="light"
              color={ticketStatusColor(ticket.status)}
              style={{ alignSelf: "flex-start" }}
            >
              {humanizeTicketStatus(ticket.status)}
            </Badge>
          </Box>
          <Box className="detail-meta-card">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Target branch
            </Text>
            <Text fw={700}>{ticket.target_branch}</Text>
          </Box>
        </Box>

        <Stack gap="xs">
          <Text fw={700}>Description</Text>
          <MarkdownContent
            className="markdown-muted markdown-small"
            content={ticket.description}
            onTicketReferenceNavigate={navigateToTicketReference}
            ticketReferences={ticket.ticket_references ?? []}
          />
        </Stack>

        {ticket.acceptance_criteria.length > 0 ? (
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Acceptance Criteria
            </Text>
            <MarkdownListItems items={ticket.acceptance_criteria} />
          </Stack>
        ) : null}
      </Stack>
    </SectionCard>
  );
}
