import {
  Badge,
  Code,
  Container,
  Group,
  List,
  Loader,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import { SectionCard } from "./components/SectionCard.js";

const apiBaseUrl = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4000";

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

type HealthResponse = {
  ok: true;
  service: "backend";
  timestamp: string;
};

type Project = {
  id: string;
  name: string;
  slug: string;
  default_target_branch: string | null;
};

type ProjectsResponse = {
  projects: Project[];
};

export function App() {
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => fetchJson<HealthResponse>("/health"),
    retry: false
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => fetchJson<ProjectsResponse>("/projects"),
    retry: false
  });

  return (
    <Container size="xl" py="xl">
      <Stack gap="xl">
        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Title order={1}>Orchestrator Starter Pack</Title>
            <Badge color={healthQuery.data?.ok ? "green" : "gray"} variant="light">
              {healthQuery.data?.ok ? "Backend reachable" : "Backend pending"}
            </Badge>
          </Group>
          <Text c="dimmed" maw={820}>
            This starter pack turns the PRD into a real workspace: shared contracts,
            database schema, backend route boundaries, and a frontend shell that can
            grow into the MVP.
          </Text>
        </Stack>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
          <SectionCard
            title="Backend Status"
            description="The local backend exposes the first scaffolded routes and event transport."
          >
            {healthQuery.isPending ? (
              <Loader size="sm" />
            ) : healthQuery.isError ? (
              <Text c="red" size="sm">
                {healthQuery.error.message}
              </Text>
            ) : (
              <List spacing="xs" size="sm">
                <List.Item>
                  Service: <Code>{healthQuery.data.service}</Code>
                </List.Item>
                <List.Item>
                  Timestamp: <Code>{healthQuery.data.timestamp}</Code>
                </List.Item>
                <List.Item>
                  API base URL: <Code>{apiBaseUrl}</Code>
                </List.Item>
              </List>
            )}
          </SectionCard>

          <SectionCard
            title="Next Milestones"
            description="These are the first implementation steps after the scaffold."
          >
            <List spacing="xs" size="sm">
              <List.Item>Replace the in-memory store with SQLite repositories.</List.Item>
              <List.Item>Implement the Codex adapter boundary and worktree lifecycle.</List.Item>
              <List.Item>Add the terminal, validation runner, and review package flow.</List.Item>
              <List.Item>Wire real session and event streaming into the UI.</List.Item>
            </List>
          </SectionCard>
        </SimpleGrid>

        <SectionCard
          title="Workspace Modules"
          description="The repo is split so the web app, backend, contracts, and database schema can evolve independently."
        >
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Path</Table.Th>
                <Table.Th>Responsibility</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td>
                  <Code>apps/backend</Code>
                </Table.Td>
                <Table.Td>Transport, route scaffolding, event hub, starter store</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>
                  <Code>apps/web</Code>
                </Table.Td>
                <Table.Td>Frontend shell, dashboard, and future board/review UI</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>
                  <Code>packages/contracts</Code>
                </Table.Td>
                <Table.Td>Shared schemas for models, commands, and events</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>
                  <Code>packages/db</Code>
                </Table.Td>
                <Table.Td>Initial Drizzle schema aligned with the PRD data model</Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </SectionCard>

        <SectionCard
          title="Projects"
          description="Project configuration is still only lightly scaffolded, but the API boundary already exists."
        >
          {projectsQuery.isPending ? (
            <Loader size="sm" />
          ) : projectsQuery.isError ? (
            <Text c="red" size="sm">
              {projectsQuery.error.message}
            </Text>
          ) : projectsQuery.data.projects.length === 0 ? (
            <Text size="sm" c="dimmed">
              No projects are configured yet. The starter backend exposes <Code>POST /projects</Code>
              , but a full project configuration UI is still the next build step.
            </Text>
          ) : (
            <Stack gap="xs">
              {projectsQuery.data.projects.map((project) => (
                <Group key={project.id} justify="space-between">
                  <div>
                    <Text fw={600}>{project.name}</Text>
                    <Text size="sm" c="dimmed">
                      <Code>{project.slug}</Code>
                    </Text>
                  </div>
                  <Badge variant="light">
                    {project.default_target_branch ?? "no default branch"}
                  </Badge>
                </Group>
              ))}
            </Stack>
          )}
        </SectionCard>

        <SectionCard
          title="Starter Board"
          description="The visual board is still placeholder-only, but the column model matches the MVP PRD."
        >
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
            {["Draft", "Ready", "In Progress", "Review"].map((column) => (
              <Stack key={column} gap="xs">
                <Group justify="space-between">
                  <Text fw={600}>{column}</Text>
                  <Badge variant="outline">0</Badge>
                </Group>
                <Text size="sm" c="dimmed">
                  Placeholder column for the next UI milestone.
                </Text>
              </Stack>
            ))}
          </SimpleGrid>
        </SectionCard>
      </Stack>
    </Container>
  );
}
