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
  FileDiff,
  type FileDiffMetadata,
  parsePatchFiles,
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

function getFileKey(file: FileDiffMetadata, index: number): string {
  return `${file.prevName ?? ""}:${file.name}:${index}`;
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

      container.innerHTML = "";

      const instance = new FileDiff({
        diffStyle: layout === "split" ? "split" : "unified",
        hunkSeparators: "metadata",
        lineDiffType: "word",
        overflow: "scroll",
        themeType: colorScheme === "auto" ? "system" : colorScheme,
      });
      instance.render({
        fileContainer: container,
        fileDiff: file,
        forceRender: true,
      });
      instances.push(instance);
    }

    return () => {
      for (const instance of instances) {
        instance.cleanUp();
      }
    };
  }, [colorScheme, layout, parsedDiff]);

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Group gap="xs">
            <Badge variant="light" color="blue">
              Base {diff?.target_branch ?? "target"}
            </Badge>
            <Badge variant="light" color="orange">
              Worktree {diff?.working_branch ?? "branch"}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            Changes refresh automatically as files change in the ticket
            worktree.
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
            and the ticket worktree.
          </Text>
        </Box>
      ) : (
        <Stack gap="md">
          {parsedDiff.files.map((file, index) => {
            const key = getFileKey(file, index);

            return (
              <Box key={key} className="ticket-workspace-diff-file">
                <div
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
