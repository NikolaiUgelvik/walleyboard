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
import { useLocalStorage } from "@mantine/hooks";
import {
  CORE_CSS_ATTRIBUTE,
  DIFFS_TAG_NAME,
  FileDiff,
  type FileDiffMetadata,
  parsePatchFiles,
  wrapCoreCSS,
} from "@pierre/diffs";
// @ts-expect-error Tabler deep icon entrypoints do not ship declaration files.
import IconChevronDown from "@tabler/icons-react/dist/esm/icons/IconChevronDown.mjs";
// @ts-expect-error Tabler deep icon entrypoints do not ship declaration files.
import IconChevronRight from "@tabler/icons-react/dist/esm/icons/IconChevronRight.mjs";
// @ts-expect-error Tabler deep icon entrypoints do not ship declaration files.
import IconFile from "@tabler/icons-react/dist/esm/icons/IconFile.mjs";
// @ts-expect-error Tabler deep icon entrypoints do not ship declaration files.
import IconFolder from "@tabler/icons-react/dist/esm/icons/IconFolder.mjs";
// @ts-expect-error Tabler deep icon entrypoints do not ship declaration files.
import IconFolderOpen from "@tabler/icons-react/dist/esm/icons/IconFolderOpen.mjs";
import type React from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type NodeRendererProps, Tree } from "react-arborist";
import type { TicketWorkspaceDiff } from "../../../../packages/contracts/src/index.js";
import {
  buildDiffExplorerTree,
  createDiffFileEntries,
  type DiffExplorerNode,
  type DiffFileEntry,
  reconcileSelectedDiffFileKey,
  sortDiffFileEntriesByTree,
} from "./ticket-workspace-diff-tree.js";

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

type ElementSize = {
  height: number;
  width: number;
};

type PendingLayoutAnchor = {
  fileKey: string;
  scrollTop: number;
  viewportOffsetTop: number;
};

const EMPTY_RENDER_RETRY_DELAY_MS = 120;
const MAX_EMPTY_RENDER_RETRIES = 2;
const FALLBACK_EXPLORER_WIDTH = 220;
const FALLBACK_EXPLORER_HEIGHT = 420;
const DEFAULT_EXPLORER_SIZE_PERCENT = 20;
const MIN_EXPLORER_SIZE_PERCENT = 12;
const MAX_EXPLORER_SIZE_PERCENT = 48;
const EXPLORER_SIZE_STORAGE_KEY =
  "walleyboard.ticket-workspace.diff-explorer-size";
const EXPLORER_SIZE_KEYBOARD_STEP_PERCENT = 2;

const diffRendererUnsafeCss = `
  :host {
    display: block;
    border: 1px solid var(--walleyboard-diff-renderer-border);
    border-radius: 12px;
    background: var(--diffs-bg);
    overflow: hidden;
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

function clampExplorerSizePercent(value: number): number {
  return Math.max(
    MIN_EXPLORER_SIZE_PERCENT,
    Math.min(MAX_EXPLORER_SIZE_PERCENT, value),
  );
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

function shouldRetryEmptyRenderer(file: FileDiffMetadata): boolean {
  return file.hunks.length > 0;
}

function hasRenderedDiffContent(fileContainer: HTMLElement): boolean {
  const shadowRoot = fileContainer.shadowRoot;
  if (!shadowRoot) {
    return false;
  }

  return (
    shadowRoot.querySelector(
      [
        "code[data-unified] [data-line]",
        "code[data-unified] [data-no-newline]",
        "code[data-deletions] [data-line]",
        "code[data-deletions] [data-no-newline]",
        "code[data-additions] [data-line]",
        "code[data-additions] [data-no-newline]",
      ].join(", "),
    ) !== null
  );
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

function useMeasuredElement<T extends HTMLElement>(): {
  elementRef: React.RefObject<T | null>;
  measure: () => void;
  ref: (node: T | null) => void;
  size: ElementSize;
} {
  const elementRef = useRef<T | null>(null);
  const [size, setSize] = useState<ElementSize>({ height: 0, width: 0 });

  const updateSize = useCallback(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    const nextSize = {
      height: element.clientHeight,
      width: element.clientWidth,
    };

    setSize((currentSize) =>
      currentSize.width === nextSize.width &&
      currentSize.height === nextSize.height
        ? currentSize
        : nextSize,
    );
  }, []);

  const ref = useCallback(
    (node: T | null) => {
      elementRef.current = node;
      updateSize();
    },
    [updateSize],
  );

  useLayoutEffect(() => {
    updateSize();
  }, [updateSize]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateSize();
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [updateSize]);

  return { elementRef, measure: updateSize, ref, size };
}

function getMostVisibleFileKey(
  fileEntries: readonly DiffFileEntry[],
  fileSections: Record<string, HTMLDivElement | null>,
  viewport: HTMLDivElement,
): string | null {
  if (fileEntries.length === 0) {
    return null;
  }

  const viewportRect = viewport.getBoundingClientRect();
  if (viewportRect.height <= 0 && viewport.clientHeight <= 0) {
    return null;
  }

  let hasMeasuredSection = false;
  let bestMatch: {
    key: string;
    top: number;
    visibleHeight: number;
    visibleRatio: number;
  } | null = null;

  for (const entry of fileEntries) {
    const section = fileSections[entry.key];
    if (!section) {
      continue;
    }

    const sectionRect = section.getBoundingClientRect();
    if (
      sectionRect.height > 0 ||
      sectionRect.top !== 0 ||
      sectionRect.bottom !== 0
    ) {
      hasMeasuredSection = true;
    }

    const visibleTop = Math.max(sectionRect.top, viewportRect.top);
    const visibleBottom = Math.min(sectionRect.bottom, viewportRect.bottom);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    if (visibleHeight <= 0) {
      continue;
    }

    const visibleRatio =
      sectionRect.height > 0 ? visibleHeight / sectionRect.height : 0;
    if (
      bestMatch === null ||
      visibleHeight > bestMatch.visibleHeight ||
      (visibleHeight === bestMatch.visibleHeight &&
        visibleRatio > bestMatch.visibleRatio) ||
      (visibleHeight === bestMatch.visibleHeight &&
        visibleRatio === bestMatch.visibleRatio &&
        sectionRect.top < bestMatch.top)
    ) {
      bestMatch = {
        key: entry.key,
        top: sectionRect.top,
        visibleHeight,
        visibleRatio,
      };
    }
  }

  if (!hasMeasuredSection) {
    return null;
  }

  return bestMatch?.key ?? fileEntries.at(0)?.key ?? null;
}

type DiffExplorerTreeNodeProps = NodeRendererProps<DiffExplorerNode> & {
  isSelected: boolean;
  onFileActivate: (fileKey: string) => void;
};

function DiffExplorerTreeNode({
  isSelected,
  node,
  onFileActivate,
  style,
}: DiffExplorerTreeNodeProps) {
  const isDirectory = node.data.kind === "directory";
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (isDirectory) {
        node.toggle();
        return;
      }

      if (node.data.kind === "file") {
        onFileActivate(node.data.fileKey);
      }
    },
    [isDirectory, node, onFileActivate],
  );

  return (
    <div
      style={style}
      className="ticket-workspace-diff-tree-node-shell"
      data-selected={isSelected || undefined}
    >
      <button
        type="button"
        className="ticket-workspace-diff-tree-node"
        data-file-key={
          node.data.kind === "file" ? node.data.fileKey : undefined
        }
        data-node-id={node.data.id}
        data-node-kind={node.data.kind}
        data-selected={isSelected || undefined}
        onClick={handleClick}
        title={node.data.path}
      >
        <span className="ticket-workspace-diff-tree-node-chevron">
          {isDirectory ? (
            node.isOpen ? (
              <IconChevronDown size={14} stroke={1.8} />
            ) : (
              <IconChevronRight size={14} stroke={1.8} />
            )
          ) : (
            <span className="ticket-workspace-diff-tree-node-chevron-spacer" />
          )}
        </span>
        <span className="ticket-workspace-diff-tree-node-icon">
          {isDirectory ? (
            node.isOpen ? (
              <IconFolderOpen size={14} stroke={1.8} />
            ) : (
              <IconFolder size={14} stroke={1.8} />
            )
          ) : (
            <IconFile size={14} stroke={1.8} />
          )}
        </span>
        <span className="ticket-workspace-diff-tree-node-label">
          {node.data.label}
        </span>
        {node.data.kind === "file" ? (
          <span
            className="ticket-workspace-diff-tree-node-status"
            data-status={node.data.status}
          >
            {node.data.status}
          </span>
        ) : null}
      </button>
    </div>
  );
}

export function TicketWorkspaceDiffPanel({
  diff,
  error,
  isLoading,
  layout,
  onLayoutChange,
}: TicketWorkspaceDiffPanelProps) {
  const { colorScheme } = useMantineColorScheme();
  const diffPanelRef = useRef<HTMLDivElement | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const explorerSizePercentRef = useRef(DEFAULT_EXPLORER_SIZE_PERCENT);
  const fileSectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const rendererHostRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const retryCountsRef = useRef<Record<string, number>>({});
  const diffViewportRef = useRef<HTMLDivElement | null>(null);
  const layoutScrollRestoreFrameRef = useRef<number | null>(null);
  const pendingLayoutAnchorRef = useRef<PendingLayoutAnchor | null>(null);
  const previousLayoutRef = useRef<DiffLayout>(layout);
  const [renderRetryNonce, setRenderRetryNonce] = useState(0);
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null);
  const [explorerSizePercent, setExplorerSizePercent] = useLocalStorage<number>(
    {
      key: EXPLORER_SIZE_STORAGE_KEY,
      defaultValue: DEFAULT_EXPLORER_SIZE_PERCENT,
      getInitialValueInEffect: false,
      serialize: (value) => String(clampExplorerSizePercent(value)),
      deserialize: (value) => {
        const parsedValue = Number.parseFloat(value ?? "");
        return Number.isFinite(parsedValue)
          ? clampExplorerSizePercent(parsedValue)
          : DEFAULT_EXPLORER_SIZE_PERCENT;
      },
    },
  );
  const [isResizingExplorer, setIsResizingExplorer] = useState(false);
  const {
    elementRef: explorerTreeContainerRef,
    measure: measureExplorerTree,
    ref: explorerTreeRef,
    size: explorerTreeSize,
  } = useMeasuredElement<HTMLDivElement>();

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

  const rawFileEntries = useMemo(
    () => createDiffFileEntries(parsedDiff.files),
    [parsedDiff.files],
  );
  const explorerTree = useMemo(
    () => buildDiffExplorerTree(rawFileEntries),
    [rawFileEntries],
  );
  const fileEntries = useMemo(
    () => sortDiffFileEntriesByTree(rawFileEntries, explorerTree),
    [explorerTree, rawFileEntries],
  );
  const diffStats = useMemo(
    () =>
      fileEntries.reduce(
        (summary, entry) => {
          const counts = summarizeFile(entry.file);
          return {
            additions: summary.additions + counts.additions,
            deletions: summary.deletions + counts.deletions,
            files: summary.files + 1,
          };
        },
        { additions: 0, deletions: 0, files: 0 },
      ),
    [fileEntries],
  );
  const liveExplorerWidth = explorerTreeContainerRef.current?.clientWidth ?? 0;
  const explorerWidth =
    liveExplorerWidth > 0
      ? liveExplorerWidth
      : explorerTreeSize.width > 0
        ? explorerTreeSize.width
        : FALLBACK_EXPLORER_WIDTH;
  const explorerHeight =
    explorerTreeSize.height > 0
      ? explorerTreeSize.height
      : Math.max(
          FALLBACK_EXPLORER_HEIGHT,
          Math.min(fileEntries.length * 28 + 32, 560),
        );
  useEffect(() => {
    const nextSelectedFileKey = reconcileSelectedDiffFileKey(
      selectedFileKey,
      fileEntries,
    );

    if (nextSelectedFileKey !== selectedFileKey) {
      setSelectedFileKey(nextSelectedFileKey);
    }
  }, [fileEntries, selectedFileKey]);

  useEffect(() => {
    const activeKeys = new Set(fileEntries.map((entry) => entry.key));

    for (const key of Object.keys(retryCountsRef.current)) {
      if (!activeKeys.has(key)) {
        delete retryCountsRef.current[key];
      }
    }
  }, [fileEntries]);

  const stopExplorerResize = useCallback(() => {
    resizeCleanupRef.current?.();
  }, []);

  useEffect(
    () => () => {
      stopExplorerResize();
      if (layoutScrollRestoreFrameRef.current !== null) {
        window.cancelAnimationFrame(layoutScrollRestoreFrameRef.current);
      }
    },
    [stopExplorerResize],
  );

  useLayoutEffect(() => {
    const viewport = diffViewportRef.current;
    if (!viewport) {
      previousLayoutRef.current = layout;
      return;
    }

    if (previousLayoutRef.current !== layout) {
      const fileKey =
        selectedFileKey ??
        getMostVisibleFileKey(fileEntries, fileSectionRefs.current, viewport);
      const anchorSection = fileKey ? fileSectionRefs.current[fileKey] : null;
      const viewportRect = viewport.getBoundingClientRect();
      const anchorRect = anchorSection?.getBoundingClientRect();

      pendingLayoutAnchorRef.current = fileKey
        ? {
            fileKey,
            scrollTop: viewport.scrollTop,
            viewportOffsetTop:
              anchorRect && viewportRect
                ? anchorRect.top - viewportRect.top
                : 0,
          }
        : null;
      previousLayoutRef.current = layout;
    }
  }, [fileEntries, layout, selectedFileKey]);

  const syncExplorerTreeViewport = useCallback(() => {
    const explorerTreeContainer = explorerTreeContainerRef.current;
    if (!explorerTreeContainer) {
      return;
    }

    const treeViewport = explorerTreeContainer.querySelector<HTMLElement>(
      ".ticket-workspace-diff-tree",
    );
    if (!treeViewport) {
      return;
    }

    treeViewport.style.width = `${explorerTreeContainer.clientWidth}px`;
  }, [explorerTreeContainerRef]);

  useLayoutEffect(() => {
    explorerSizePercentRef.current = explorerSizePercent;
    diffPanelRef.current?.style.setProperty(
      "--ticket-workspace-diff-explorer-size",
      `${explorerSizePercent}%`,
    );
    syncExplorerTreeViewport();
  }, [explorerSizePercent, syncExplorerTreeViewport]);

  useLayoutEffect(() => {
    syncExplorerTreeViewport();
  }, [syncExplorerTreeViewport]);

  const updateExplorerSizeFromClientX = useCallback(
    (clientX: number) => {
      const panel = diffPanelRef.current;
      if (!panel) {
        return;
      }

      const panelRect = panel.getBoundingClientRect();
      if (panelRect.width <= 0) {
        return;
      }

      const nextPercent = ((clientX - panelRect.left) / panelRect.width) * 100;
      const clampedPercent = clampExplorerSizePercent(nextPercent);
      explorerSizePercentRef.current = clampedPercent;
      panel.style.setProperty(
        "--ticket-workspace-diff-explorer-size",
        `${clampedPercent}%`,
      );
      syncExplorerTreeViewport();
    },
    [syncExplorerTreeViewport],
  );

  const handleExplorerResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      stopExplorerResize();
      setIsResizingExplorer(true);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        updateExplorerSizeFromClientX(moveEvent.clientX);
      };

      const cleanup = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", cleanup);
        window.removeEventListener("blur", cleanup);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
        setExplorerSizePercent(explorerSizePercentRef.current);
        setIsResizingExplorer(false);
        window.requestAnimationFrame(() => {
          measureExplorerTree();
          syncExplorerTreeViewport();
        });
        if (resizeCleanupRef.current === cleanup) {
          resizeCleanupRef.current = null;
        }
      };

      resizeCleanupRef.current = cleanup;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", cleanup);
      window.addEventListener("blur", cleanup);
    },
    [
      measureExplorerTree,
      setExplorerSizePercent,
      stopExplorerResize,
      syncExplorerTreeViewport,
      updateExplorerSizeFromClientX,
    ],
  );

  const handleExplorerResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setExplorerSizePercent((value) =>
          clampExplorerSizePercent(value - EXPLORER_SIZE_KEYBOARD_STEP_PERCENT),
        );
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setExplorerSizePercent((value) =>
          clampExplorerSizePercent(value + EXPLORER_SIZE_KEYBOARD_STEP_PERCENT),
        );
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        setExplorerSizePercent(MIN_EXPLORER_SIZE_PERCENT);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        setExplorerSizePercent(MAX_EXPLORER_SIZE_PERCENT);
      }
    },
    [setExplorerSizePercent],
  );

  const scrollToFile = useCallback((fileKey: string) => {
    const target = fileSectionRefs.current[fileKey];
    const viewport = diffViewportRef.current;
    if (!target || !viewport) {
      return;
    }

    const targetRect = target.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const rawScrollTop =
      targetRect.top - viewportRect.top + viewport.scrollTop - 8;
    const maxScrollTop = Math.max(
      0,
      viewport.scrollHeight - viewport.clientHeight,
    );
    const nextScrollTop = Math.max(0, Math.min(maxScrollTop, rawScrollTop));

    if (typeof viewport.scrollTo === "function") {
      viewport.scrollTo({ top: nextScrollTop });
      return;
    }

    viewport.scrollTop = nextScrollTop;
  }, []);

  const handleFileActivate = useCallback(
    (fileKey: string) => {
      setSelectedFileKey(fileKey);
      scrollToFile(fileKey);
    },
    [scrollToFile],
  );

  const renderTreeNode = useCallback(
    (props: NodeRendererProps<DiffExplorerNode>) => (
      <DiffExplorerTreeNode
        {...props}
        isSelected={
          props.node.data.kind === "file" &&
          props.node.data.fileKey === selectedFileKey
        }
        onFileActivate={handleFileActivate}
      />
    ),
    [handleFileActivate, selectedFileKey],
  );

  useEffect(() => {
    const viewport = diffViewportRef.current;
    if (!viewport || fileEntries.length === 0) {
      return;
    }

    let animationFrameId = 0;

    const syncSelectionToViewport = () => {
      animationFrameId = 0;
      const nextSelectedFileKey = getMostVisibleFileKey(
        fileEntries,
        fileSectionRefs.current,
        viewport,
      );

      if (!nextSelectedFileKey) {
        return;
      }

      setSelectedFileKey((currentSelectedFileKey) =>
        currentSelectedFileKey === nextSelectedFileKey
          ? currentSelectedFileKey
          : nextSelectedFileKey,
      );
    };

    const scheduleSync = () => {
      if (animationFrameId !== 0) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(syncSelectionToViewport);
    };

    scheduleSync();
    viewport.addEventListener("scroll", scheduleSync, { passive: true });
    window.addEventListener("resize", scheduleSync);

    return () => {
      viewport.removeEventListener("scroll", scheduleSync);
      window.removeEventListener("resize", scheduleSync);
      if (animationFrameId !== 0) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [fileEntries]);

  useEffect(() => {
    if (parsedDiff.error) {
      return;
    }

    const renderPass = renderRetryNonce;
    const instances: FileDiff[] = [];
    const retryTimers = new Set<number>();
    const pendingRetryKeys = new Set<string>();
    let cancelled = false;

    const queueRenderRetry = (
      key: string,
      file: FileDiffMetadata,
      fileContainer: HTMLElement,
    ): void => {
      if (
        cancelled ||
        !shouldRetryEmptyRenderer(file) ||
        pendingRetryKeys.has(key) ||
        (retryCountsRef.current[key] ?? 0) >= MAX_EMPTY_RENDER_RETRIES
      ) {
        return;
      }

      pendingRetryKeys.add(key);
      const timerId = window.setTimeout(() => {
        retryTimers.delete(timerId);
        pendingRetryKeys.delete(key);

        if (
          cancelled ||
          !fileContainer.isConnected ||
          !diffViewportRef.current ||
          hasRenderedDiffContent(fileContainer)
        ) {
          return;
        }

        retryCountsRef.current[key] = (retryCountsRef.current[key] ?? 0) + 1;
        setRenderRetryNonce((value) => value + 1);
      }, EMPTY_RENDER_RETRY_DELAY_MS);
      retryTimers.add(timerId);
    };

    for (const entry of fileEntries) {
      const container = rendererHostRefs.current[entry.key];
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
        onPostRender: (renderedFileContainer) => {
          ensureDiffRendererCoreStyles(renderedFileContainer);
          if (
            renderPass >= 0 &&
            !hasRenderedDiffContent(renderedFileContainer)
          ) {
            queueRenderRetry(entry.key, entry.file, renderedFileContainer);
          }
        },
        overflow: "scroll",
        themeType: colorScheme === "auto" ? "system" : colorScheme,
        unsafeCSS: diffRendererUnsafeCss,
      });
      instance.render({
        fileContainer,
        fileDiff: entry.file,
        forceRender: true,
      });
      ensureDiffRendererCoreStyles(fileContainer);
      instances.push(instance);
    }

    return () => {
      cancelled = true;
      for (const timerId of retryTimers) {
        window.clearTimeout(timerId);
      }

      for (const instance of instances) {
        instance.cleanUp();
      }
    };
  }, [colorScheme, fileEntries, layout, parsedDiff.error, renderRetryNonce]);

  useEffect(() => {
    const viewport = diffViewportRef.current;
    const pendingAnchor = pendingLayoutAnchorRef.current;
    if (!viewport || pendingAnchor === null) {
      return;
    }

    pendingLayoutAnchorRef.current = null;
    const restoreAnchorPosition = () => {
      const liveViewport = diffViewportRef.current;
      if (!liveViewport) {
        return;
      }

      const anchorSection = fileSectionRefs.current[pendingAnchor.fileKey];
      if (!anchorSection) {
        const maxScrollTop = Math.max(
          0,
          liveViewport.scrollHeight - liveViewport.clientHeight,
        );
        liveViewport.scrollTop = Math.max(
          0,
          Math.min(maxScrollTop, pendingAnchor.scrollTop),
        );
        return;
      }

      const viewportRect = liveViewport.getBoundingClientRect();
      const anchorRect = anchorSection.getBoundingClientRect();
      const currentOffsetTop = anchorRect.top - viewportRect.top;
      const nextScrollTop =
        liveViewport.scrollTop +
        currentOffsetTop -
        pendingAnchor.viewportOffsetTop;
      const maxScrollTop = Math.max(
        0,
        liveViewport.scrollHeight - liveViewport.clientHeight,
      );
      liveViewport.scrollTop = Math.max(
        0,
        Math.min(maxScrollTop, nextScrollTop),
      );
    };

    restoreAnchorPosition();
    layoutScrollRestoreFrameRef.current = window.requestAnimationFrame(
      restoreAnchorPosition,
    );

    return () => {
      if (layoutScrollRestoreFrameRef.current !== null) {
        window.cancelAnimationFrame(layoutScrollRestoreFrameRef.current);
        layoutScrollRestoreFrameRef.current = null;
      }
    };
  });

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
  const diffStageContent = useMemo(
    () => (
      <section
        className="ticket-workspace-diff-stage"
        id="ticket-workspace-diff-stage"
      >
        <div
          className="ticket-workspace-diff-stage-scroll"
          ref={diffViewportRef}
        >
          <Stack gap="sm" className="ticket-workspace-diff-stage-content">
            {fileEntries.map((entry) => {
              const summary = summarizeFile(entry.file);
              const isSelected = selectedFileKey === entry.key;

              return (
                <Box
                  key={entry.key}
                  className="ticket-workspace-diff-file"
                  data-file-key={entry.key}
                  data-selected={isSelected || undefined}
                  ref={(node) => {
                    fileSectionRefs.current[entry.key] = node;
                  }}
                >
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
                          {entry.file.prevName
                            ? `${entry.file.prevName} -> ${entry.file.name}`
                            : entry.file.name}
                        </Text>
                      </Group>
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
                      rendererHostRefs.current[entry.key] = node;
                    }}
                  />
                </Box>
              );
            })}
          </Stack>
        </div>
      </section>
    ),
    [fileEntries, selectedFileKey],
  );

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
      ) : !diff || fileEntries.length === 0 ? (
        <Box className="ticket-workspace-diff-empty">
          <Text size="sm" c="dimmed">
            No differences between {diff?.target_branch ?? "the target branch"}{" "}
            and the selected ticket diff.
          </Text>
        </Box>
      ) : (
        <Box
          className="ticket-workspace-diff-panel"
          data-resizing={isResizingExplorer || undefined}
          ref={diffPanelRef}
        >
          <aside className="ticket-workspace-diff-explorer">
            <div className="ticket-workspace-diff-explorer-header">
              <Text
                size="sm"
                fw={700}
                className="ticket-workspace-diff-explorer-title"
              >
                Diff
              </Text>
              <div className="ticket-workspace-diff-explorer-summary">
                <Text size="xs" c="dimmed">
                  {diffStats.files} {diffStats.files === 1 ? "file" : "files"}
                </Text>
                <Text
                  size="xs"
                  className="ticket-workspace-diff-explorer-summary-metric"
                  data-tone="positive"
                >
                  +{diffStats.additions}
                </Text>
                <Text
                  size="xs"
                  className="ticket-workspace-diff-explorer-summary-metric"
                  data-tone="negative"
                >
                  -{diffStats.deletions}
                </Text>
              </div>
            </div>
            <div
              className="ticket-workspace-diff-explorer-tree"
              ref={explorerTreeRef}
            >
              <Tree
                className="ticket-workspace-diff-tree"
                data={explorerTree}
                disableDrag
                disableEdit
                disableMultiSelection
                height={explorerHeight}
                indent={9}
                openByDefault
                overscanCount={8}
                paddingTop={4}
                paddingBottom={10}
                rowHeight={26}
                width={explorerWidth}
              >
                {renderTreeNode}
              </Tree>
            </div>
            <div className="ticket-workspace-diff-explorer-footer">
              <SegmentedControl
                size="xs"
                radius="xl"
                value={layout}
                onChange={(value) => onLayoutChange(value as DiffLayout)}
                data={[
                  { label: "Split", value: "split" },
                  { label: "Stacked", value: "stacked" },
                ]}
              />
            </div>
          </aside>

          <Box
            aria-controls="ticket-workspace-diff-stage"
            aria-label="Resize diff sidebar"
            aria-orientation="vertical"
            aria-valuemax={MAX_EXPLORER_SIZE_PERCENT}
            aria-valuemin={MIN_EXPLORER_SIZE_PERCENT}
            aria-valuenow={Math.round(explorerSizePercent)}
            className="ticket-workspace-diff-sash"
            onKeyDown={handleExplorerResizeKeyDown}
            onMouseDown={handleExplorerResizeStart}
            role="separator"
            tabIndex={0}
          />

          {diffStageContent}
        </Box>
      )}
    </Stack>
  );
}
