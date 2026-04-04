import {
  Badge,
  Box,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Text,
  useMantineColorScheme,
} from "@mantine/core";
import {
  CORE_CSS_ATTRIBUTE,
  DIFFS_TAG_NAME,
  FileDiff,
  type FileDiffMetadata,
  parsePatchFiles,
  wrapCoreCSS,
} from "@pierre/diffs";
import { useEffect, useMemo, useRef } from "react";
import type { TicketWorkspaceDiff } from "../../../../packages/contracts/src/index.js";

type DiffLayout = "split" | "stacked";

type TicketWorkspaceDiffPanelProps = {
  diff: TicketWorkspaceDiff | null;
  error?: string | null;
  isLoading: boolean;
  layout: DiffLayout;
  onLayoutChange: (value: DiffLayout) => void;
};

type DiffFileSummary = {
  additions: number;
  deletions: number;
  tone: "blue" | "green" | "orange" | "red";
  label: string;
};

const diffRendererUnsafeCss = `
  :host {
    display: block;
    border: 1px solid var(--walleyboard-diff-renderer-border);
    border-radius: 16px;
    background: var(--diffs-bg);
    overflow: hidden;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }

  [data-diff],
  [data-file] {
    margin: 0;
    background: var(--diffs-bg);
  }

  [data-code] {
    scrollbar-color: var(--walleyboard-diff-gutter-divider) transparent;
  }

  [data-code]::-webkit-scrollbar-thumb {
    background-color: transparent;
  }

  [data-diff]:hover [data-code]::-webkit-scrollbar-thumb,
  [data-file]:hover [data-code]::-webkit-scrollbar-thumb {
    background-color: var(--walleyboard-diff-gutter-divider);
  }

  [data-gutter] {
    background: var(--diffs-bg);
  }

  [data-line],
  [data-no-newline],
  [data-gutter-buffer],
  [data-column-number] {
    border-bottom: 1px solid var(--walleyboard-diff-row-divider);
  }

  [data-line]:last-child,
  [data-no-newline]:last-child,
  [data-gutter-buffer]:last-child,
  [data-column-number]:last-child {
    border-bottom: 0;
  }

  [data-diff-type="split"][data-overflow="scroll"] [data-additions] {
    border-left: 1px solid var(--walleyboard-diff-split-divider);
  }

  [data-diff-type="split"][data-overflow="scroll"] [data-deletions] {
    border-right: 1px solid var(--walleyboard-diff-split-divider);
  }

  [data-diff-type="split"][data-overflow="wrap"] [data-deletions] [data-content] {
    border-right: 1px solid var(--walleyboard-diff-split-divider);
  }

  [data-diff-type="split"][data-overflow="wrap"] [data-additions] [data-gutter] {
    border-left: 1px solid var(--walleyboard-diff-split-divider);
  }

  [data-separator] {
    border-top: 1px solid var(--walleyboard-diff-row-divider);
    border-bottom: 1px solid var(--walleyboard-diff-row-divider);
  }

  [data-separator-wrapper] {
    padding-inline: 16px;
  }

  [data-separator-content],
  [data-expand-button] {
    color: var(--walleyboard-diff-number-fg);
  }

  [data-expand-button] {
    border-right: 1px solid var(--walleyboard-diff-row-divider);
  }

  [data-column-number] {
    background-clip: padding-box;
  }
`;

function getFileKey(file: FileDiffMetadata, index: number): string {
  return `${file.prevName ?? ""}:${file.name}:${index}`;
}

function summarizeFile(file: FileDiffMetadata): DiffFileSummary {
  const counts = file.hunks.reduce(
    (summary, hunk) => ({
      additions: summary.additions + hunk.additionLines,
      deletions: summary.deletions + hunk.deletionLines,
    }),
    { additions: 0, deletions: 0 },
  );

  switch (file.type) {
    case "new":
      return { ...counts, label: "Added", tone: "green" };
    case "deleted":
      return { ...counts, label: "Deleted", tone: "red" };
    case "rename-pure":
      return { ...counts, label: "Renamed", tone: "blue" };
    case "rename-changed":
      return { ...counts, label: "Renamed + edited", tone: "orange" };
    default:
      return { ...counts, label: "Edited", tone: "blue" };
  }
}

function ensureDiffRendererCoreStyles(fileContainer: HTMLElement): void {
  const shadowRoot = fileContainer.shadowRoot;
  if (!shadowRoot) {
    return;
  }

  if (shadowRoot.querySelector(`style[${CORE_CSS_ATTRIBUTE}]`)) {
    return;
  }

  const adoptedStyleSheetCount =
    "adoptedStyleSheets" in shadowRoot
      ? shadowRoot.adoptedStyleSheets.length
      : 0;
  if (adoptedStyleSheetCount > 0) {
    return;
  }

  const coreStyle = document.createElement("style");
  coreStyle.setAttribute(CORE_CSS_ATTRIBUTE, "");
  coreStyle.textContent = wrapCoreCSS("");
  shadowRoot.prepend(coreStyle);
}

export function TicketWorkspaceDiffPanel({
  diff,
  error,
  isLoading,
  layout,
  onLayoutChange,
}: TicketWorkspaceDiffPanelProps) {
  const { colorScheme } = useMantineColorScheme();
  const containerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const parsedDiff = useMemo(() => {
    if (!diff) {
      return {
        error: null as string | null,
        files: [] as FileDiffMetadata[],
      };
    }

    try {
      return {
        error: null,
        files: parsePatchFiles(diff.patch).flatMap((patch) => patch.files),
      };
    } catch (parseError) {
      return {
        error:
          parseError instanceof Error
            ? parseError.message
            : "Unable to parse the current diff",
        files: [] as FileDiffMetadata[],
      };
    }
  }, [diff]);

  const diffStats = useMemo(
    () =>
      parsedDiff.files.reduce(
        (summary, file) => {
          const counts = summarizeFile(file);
          return {
            additions: summary.additions + counts.additions,
            deletions: summary.deletions + counts.deletions,
            files: summary.files + 1,
          };
        },
        { additions: 0, deletions: 0, files: 0 },
      ),
    [parsedDiff.files],
  );

  useEffect(() => {
    if (parsedDiff.error) {
      return;
    }

    const instances: FileDiff[] = [];
    for (const [index, file] of parsedDiff.files.entries()) {
      const key = getFileKey(file, index);
      const container = containerRefs.current[key];
      if (!container) {
        continue;
      }

      container.replaceChildren();
      const fileContainer = document.createElement(DIFFS_TAG_NAME);
      container.append(fileContainer);

      const instance = new FileDiff({
        diffStyle: layout === "split" ? "split" : "unified",
        disableFileHeader: true,
        hunkSeparators: "metadata",
        lineDiffType: "word",
        overflow: "scroll",
        themeType: colorScheme === "auto" ? "system" : colorScheme,
        unsafeCSS: diffRendererUnsafeCss,
      });
      instance.render({
        fileContainer,
        fileDiff: file,
        forceRender: true,
      });
      ensureDiffRendererCoreStyles(fileContainer);
      instances.push(instance);
    }

    return () => {
      for (const instance of instances) {
        instance.cleanUp();
      }
    };
  }, [colorScheme, layout, parsedDiff]);

  const sourceLabel =
    diff === null
      ? "Ticket diff"
      : diff.source === "review_artifact"
        ? "Stored review diff"
        : "Live worktree";
  const sourceDescription =
    diff === null
      ? "Loading the selected ticket diff."
      : diff.source === "review_artifact"
        ? "Showing the persisted review artifact captured before cleanup. Archived and restored tickets reuse this stored patch."
        : "Changes refresh automatically as files change in the ticket worktree.";

  return (
    <Stack gap="md" className="ticket-workspace-diff-shell">
      <Group
        justify="space-between"
        align="flex-start"
        className="ticket-workspace-diff-toolbar"
      >
        <Stack gap={4}>
          <Group gap="xs" className="ticket-workspace-diff-toolbar-badges">
            <Badge variant="light" color="gray">
              {sourceLabel}
            </Badge>
            <Badge variant="light" color="blue">
              Base {diff?.target_branch ?? "target"}
            </Badge>
            <Badge variant="light" color="orange">
              Branch {diff?.working_branch ?? "review artifact"}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            {sourceDescription}
          </Text>
        </Stack>
        <SegmentedControl
          value={layout}
          onChange={(value) => onLayoutChange(value as DiffLayout)}
          data={[
            { label: "Split", value: "split" },
            { label: "Stacked", value: "stacked" },
          ]}
        />
      </Group>

      {diff && parsedDiff.files.length > 0 ? (
        <Group gap="xs" className="ticket-workspace-diff-stats">
          <Badge variant="outline" color="gray">
            {diffStats.files} {diffStats.files === 1 ? "file" : "files"}
          </Badge>
          <Badge variant="outline" color="green">
            +{diffStats.additions}
          </Badge>
          <Badge variant="outline" color="red">
            -{diffStats.deletions}
          </Badge>
        </Group>
      ) : null}

      {isLoading ? (
        <Group justify="center" className="ticket-workspace-diff-empty">
          <Loader size="sm" />
        </Group>
      ) : error ? (
        <Box className="detail-placeholder">
          <Text size="sm" c="red">
            {error}
          </Text>
        </Box>
      ) : parsedDiff.error ? (
        <Box className="detail-placeholder">
          <Text size="sm" c="red">
            {parsedDiff.error}
          </Text>
        </Box>
      ) : !diff || parsedDiff.files.length === 0 ? (
        <Box className="ticket-workspace-diff-empty">
          <Text size="sm" c="dimmed">
            No differences between {diff?.target_branch ?? "the target branch"}{" "}
            and the selected ticket diff.
          </Text>
        </Box>
      ) : (
        <Stack gap="md">
          {parsedDiff.files.map((file, index) => {
            const key = getFileKey(file, index);
            const summary = summarizeFile(file);

            return (
              <Box key={key} className="ticket-workspace-diff-file">
                <Group
                  justify="space-between"
                  align="flex-start"
                  className="ticket-workspace-diff-file-header"
                >
                  <Stack gap={2}>
                    <Group gap="xs">
                      <Badge size="xs" variant="light" color={summary.tone}>
                        {summary.label}
                      </Badge>
                      <Text
                        size="sm"
                        fw={600}
                        className="ticket-workspace-diff-file-path"
                      >
                        {file.prevName
                          ? `${file.prevName} -> ${file.name}`
                          : file.name}
                      </Text>
                    </Group>
                    <Text size="xs" c="dimmed">
                      {file.lang ? `${file.lang} syntax` : "Detected syntax"}{" "}
                      with line numbers and inline highlights.
                    </Text>
                  </Stack>
                  <Group gap={6}>
                    <Badge size="xs" variant="outline" color="green">
                      +{summary.additions}
                    </Badge>
                    <Badge size="xs" variant="outline" color="red">
                      -{summary.deletions}
                    </Badge>
                  </Group>
                </Group>
                <div
                  className="ticket-workspace-diff-renderer"
                  ref={(node) => {
                    containerRefs.current[key] = node;
                  }}
                />
              </Box>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
