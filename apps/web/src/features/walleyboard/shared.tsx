import {
  Badge,
  Box,
  Group,
  Input,
  List,
  SegmentedControl,
  Select,
  Stack,
  Text,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
// @ts-expect-error Tabler deep icon entrypoints do not ship declaration files.
import IconCheck from "@tabler/icons-react/dist/esm/icons/IconCheck.mjs";
import type {
  AgentAdapter,
  ReviewAction,
} from "../../../../../packages/contracts/src/index.js";

import { MarkdownContent } from "../../components/MarkdownContent.js";
import type { DraftQuestionsResult } from "./shared-types.js";
import {
  getProjectColorSwatchForegroundColor,
  parseDraftQuestionsResult,
  parseDraftRefinementResult,
  projectColorPalette,
} from "./shared-utils.js";

export const boardColumns = [
  "draft",
  "ready",
  "in_progress",
  "review",
  "done",
] as const;

export const boardColumnMeta: Record<
  (typeof boardColumns)[number],
  { label: string; accent: string; empty: string }
> = {
  draft: {
    label: "Draft",
    accent: "#6b7280",
    empty: "No draft tickets yet. Use New Draft to capture the next task.",
  },
  ready: {
    label: "Ready",
    accent: "#2563eb",
    empty: "No ready tickets waiting to start.",
  },
  in_progress: {
    label: "In progress",
    accent: "#d97706",
    empty: "No tickets are currently in progress.",
  },
  review: {
    label: "In review",
    accent: "#7c3aed",
    empty: "Nothing is waiting for review right now.",
  },
  done: {
    label: "Done",
    accent: "#16a34a",
    empty: "Nothing has been merged yet.",
  },
};

export function columnBadgeStyle(accent: string) {
  return {
    background: `${accent}14`,
    color: accent,
    border: `1px solid ${accent}22`,
  };
}

const codexModelPresetValues = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
] as const;
const claudeCodeModelPresetValues = ["sonnet", "opus", "haiku"] as const;

export function getModelPresetOptions(adapter: AgentAdapter) {
  const values =
    adapter === "claude-code"
      ? claudeCodeModelPresetValues
      : codexModelPresetValues;
  return [
    { value: "default", label: "Default" },
    ...values.map((value) => ({ value, label: value })),
    { value: "custom", label: "Custom" },
  ];
}

export const projectModelPresetOptions = getModelPresetOptions("codex");

const codexReasoningEffortOptions = [
  { value: "default", label: "Default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
];

const claudeReasoningEffortOptions = [
  { value: "default", label: "Default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
];

export const reasoningEffortOptions = codexReasoningEffortOptions;

export function getReasoningEffortOptions(adapter: AgentAdapter) {
  return adapter === "claude-code"
    ? claudeReasoningEffortOptions
    : codexReasoningEffortOptions;
}
export const reviewActionOptions = [
  { label: "Direct merge", value: "direct_merge" },
  { label: "Create pull request", value: "pull_request" },
] satisfies Array<{ label: string; value: ReviewAction }>;
export const agentAdapterOptions = [
  { label: "Codex", value: "codex" },
  { label: "Claude Code", value: "claude-code" },
] satisfies Array<{ label: string; value: AgentAdapter }>;
export type AgentAdapterSelectOption = (typeof agentAdapterOptions)[number] & {
  disabled?: boolean;
};

const agentAdapterIconPaths: Record<AgentAdapter, string> = {
  codex: "/agent-icons/codex.svg",
  "claude-code": "/agent-icons/claude-code.svg",
};

export function getAgentAdapterIconPath(adapter: AgentAdapter): string {
  return agentAdapterIconPaths[adapter];
}

export function AgentAdapterIcon({ adapter }: { adapter: AgentAdapter }) {
  const colorScheme = useComputedColorScheme("light", {
    getInitialValueInEffect: false,
  });

  return (
    <img
      alt=""
      aria-hidden="true"
      height={16}
      src={getAgentAdapterIconPath(adapter)}
      style={{
        display: "block",
        filter: colorScheme === "dark" ? "brightness(0) invert(1)" : "none",
        flex: "none",
      }}
      width={16}
    />
  );
}

export function AgentAdapterOptionLabel({
  adapter,
  label,
}: {
  adapter: AgentAdapter;
  label: string;
}) {
  return (
    <Group gap="xs" wrap="nowrap">
      <AgentAdapterIcon adapter={adapter} />
      <span>{label}</span>
    </Group>
  );
}

export function ProjectAgentAdapterSelect({
  label = "Agent CLI",
  value,
  onChange,
}: {
  label?: string;
  value: AgentAdapter;
  onChange: (value: AgentAdapter) => void;
}) {
  return (
    <Select
      label={label}
      data={getProjectAgentAdapterOptions()}
      leftSection={<AgentAdapterIcon adapter={value} />}
      renderOption={({ option }) => (
        <AgentAdapterOptionLabel
          adapter={option.value === "claude-code" ? "claude-code" : "codex"}
          label={option.label}
        />
      )}
      value={value}
      onChange={(nextValue) => {
        if (nextValue !== "codex" && nextValue !== "claude-code") {
          return;
        }

        onChange(nextValue);
      }}
    />
  );
}

export function getProjectAgentAdapterOptions(): AgentAdapterSelectOption[] {
  return [
    { label: "Codex", value: "codex" },
    { label: "Claude Code", value: "claude-code", disabled: false },
  ];
}

export function ProjectColorSwatchPicker({
  description,
  label,
  onChange,
  value,
}: {
  description: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <Input.Wrapper description={description} label={label}>
      <Group aria-label={label} gap="xs" mt={8} role="radiogroup" wrap="wrap">
        {projectColorPalette.map((color) => {
          const selected = value === color;

          return (
            <UnstyledButton
              key={color}
              aria-checked={selected}
              aria-label={`${label} ${color}`}
              role="radio"
              type="button"
              onClick={() => onChange(color)}
            >
              <Box
                style={{
                  alignItems: "center",
                  backgroundColor: color,
                  border: selected
                    ? "2px solid var(--mantine-color-text)"
                    : "1px solid var(--mantine-color-default-border)",
                  borderRadius: "999px",
                  color: getProjectColorSwatchForegroundColor(color),
                  display: "flex",
                  height: 32,
                  justifyContent: "center",
                  width: 32,
                }}
              >
                {selected ? <IconCheck size={16} stroke={2.4} /> : null}
              </Box>
            </UnstyledButton>
          );
        })}
      </Group>
    </Input.Wrapper>
  );
}

export function agentLabel(adapter: AgentAdapter): string {
  switch (adapter) {
    case "codex":
      return "Codex";
    case "claude-code":
      return "Claude Code";
    default:
      return "Agent";
  }
}

export function modelPlaceholder(adapter: AgentAdapter): string {
  return adapter === "claude-code" ? "sonnet" : "gpt-5.3-spark";
}

export function MarkdownListItems({ items }: { items: string[] }) {
  const seenItems = new Map<string, number>();
  const keyedItems = items.map((item) => {
    const occurrence = seenItems.get(item) ?? 0;
    seenItems.set(item, occurrence + 1);

    return {
      item,
      key: `markdown-list-item-${item}-${occurrence}`,
    };
  });

  return (
    <List size="sm" spacing={4}>
      {keyedItems.map(({ item, key }) => (
        <List.Item key={key}>
          <MarkdownContent content={item} />
        </List.Item>
      ))}
    </List>
  );
}

export function DraftQuestionsResultView({
  result,
}: {
  result: DraftQuestionsResult;
}) {
  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <Text fw={700}>Feasibility</Text>
        <Badge variant="light" color="blue">
          {result.verdict}
        </Badge>
      </Group>
      <MarkdownContent
        className="markdown-muted markdown-small"
        content={result.summary}
      />
      {result.assumptions.length > 0 ? (
        <MarkdownListItems items={result.assumptions} />
      ) : null}
      {result.open_questions.length > 0 ? (
        <MarkdownListItems items={result.open_questions} />
      ) : null}
      {result.risks.length > 0 ? (
        <MarkdownListItems items={result.risks} />
      ) : null}
      {result.suggested_draft_edits.length > 0 ? (
        <MarkdownListItems items={result.suggested_draft_edits} />
      ) : null}
    </Stack>
  );
}

export function DraftEventResultView({
  result,
}: {
  result: Record<string, unknown>;
}) {
  const questionsResult = parseDraftQuestionsResult(result);
  if (questionsResult) {
    return <DraftQuestionsResultView result={questionsResult} />;
  }

  const refinementResult = parseDraftRefinementResult(result);
  if (refinementResult) {
    return (
      <Stack gap="xs">
        <Stack gap={2}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
            Title
          </Text>
          <MarkdownContent content={refinementResult.title_draft} inline />
        </Stack>
        <Stack gap={2}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
            Description
          </Text>
          <MarkdownContent
            className="markdown-muted markdown-small"
            content={refinementResult.description_draft}
          />
        </Stack>
        {refinementResult.split_proposal_summary ? (
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Split Proposal
            </Text>
            <MarkdownContent
              className="markdown-muted markdown-small"
              content={refinementResult.split_proposal_summary}
            />
          </Stack>
        ) : null}
        {refinementResult.proposed_acceptance_criteria.length > 0 ? (
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Acceptance Criteria
            </Text>
            <MarkdownListItems
              items={refinementResult.proposed_acceptance_criteria}
            />
          </Stack>
        ) : null}
      </Stack>
    );
  }

  return (
    <Box
      component="pre"
      className="detail-placeholder"
      style={{
        margin: 0,
        whiteSpace: "pre-wrap",
      }}
    >
      {JSON.stringify(result, null, 2)}
    </Box>
  );
}

export function ColorSchemeControl() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  return (
    <SegmentedControl
      size="xs"
      radius="xl"
      value={colorScheme}
      onChange={(value) => setColorScheme(value as "auto" | "light" | "dark")}
      data={[
        { label: "System", value: "auto" },
        { label: "Light", value: "light" },
        { label: "Dark", value: "dark" },
      ]}
    />
  );
}
