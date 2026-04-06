import type { FileDiffMetadata } from "@pierre/diffs";

export type DiffExplorerStatus = "A" | "D" | "M" | "R";

export type DiffFileEntry = {
  file: FileDiffMetadata;
  key: string;
  label: string;
  nodeId: string;
  path: string;
  status: DiffExplorerStatus;
};

export type DiffExplorerDirectoryNode = {
  children: DiffExplorerNode[];
  id: string;
  kind: "directory";
  label: string;
  path: string;
};

export type DiffExplorerFileNode = {
  fileKey: string;
  id: string;
  kind: "file";
  label: string;
  path: string;
  status: DiffExplorerStatus;
};

export type DiffExplorerNode = DiffExplorerDirectoryNode | DiffExplorerFileNode;

type MutableDirectoryNode = {
  children: Map<string, MutableDirectoryNode | DiffExplorerFileNode>;
  id: string;
  kind: "directory";
  label: string;
  path: string;
};

function getDiffExplorerStatus(file: FileDiffMetadata): DiffExplorerStatus {
  switch (file.type) {
    case "new":
      return "A";
    case "deleted":
      return "D";
    case "rename-pure":
    case "rename-changed":
      return "R";
    default:
      return "M";
  }
}

function getPathLabel(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

function createStableFileKey(
  file: FileDiffMetadata,
  duplicateCounts: Map<string, number>,
): string {
  const identity = file.prevName ? `${file.prevName}->${file.name}` : file.name;
  const nextCount = (duplicateCounts.get(identity) ?? 0) + 1;
  duplicateCounts.set(identity, nextCount);

  return nextCount === 1 ? identity : `${identity}#${nextCount}`;
}

function createDirectoryNode(
  path: string,
  label: string,
): MutableDirectoryNode {
  return {
    children: new Map(),
    id: `dir:${path}`,
    kind: "directory",
    label,
    path,
  };
}

function sortNodes(left: DiffExplorerNode, right: DiffExplorerNode): number {
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }

  return left.path.localeCompare(right.path);
}

function finalizeDirectory(
  node: MutableDirectoryNode,
): DiffExplorerDirectoryNode {
  const children = Array.from(node.children.values())
    .map((child) =>
      child.kind === "directory" ? finalizeDirectory(child) : child,
    )
    .sort(sortNodes);

  return {
    children,
    id: node.id,
    kind: "directory",
    label: node.label,
    path: node.path,
  };
}

export function createDiffFileEntries(
  files: readonly FileDiffMetadata[],
): DiffFileEntry[] {
  const duplicateCounts = new Map<string, number>();

  return files.map((file) => {
    const key = createStableFileKey(file, duplicateCounts);

    return {
      file,
      key,
      label: getPathLabel(file.name),
      nodeId: `file:${key}`,
      path: file.name,
      status: getDiffExplorerStatus(file),
    };
  });
}

export function buildDiffExplorerTree(
  fileEntries: readonly DiffFileEntry[],
): DiffExplorerNode[] {
  const root = createDirectoryNode("", "");

  for (const entry of fileEntries) {
    const pathSegments = entry.path.split("/").filter(Boolean);
    if (pathSegments.length === 0) {
      continue;
    }

    let currentDirectory = root;
    for (let index = 0; index < pathSegments.length - 1; index += 1) {
      const segment = pathSegments[index] ?? "";
      const directoryPath = pathSegments.slice(0, index + 1).join("/");
      const existingChild = currentDirectory.children.get(segment);

      if (existingChild?.kind === "directory") {
        currentDirectory = existingChild;
        continue;
      }

      const nextDirectory = createDirectoryNode(directoryPath, segment);
      currentDirectory.children.set(segment, nextDirectory);
      currentDirectory = nextDirectory;
    }

    currentDirectory.children.set(entry.nodeId, {
      fileKey: entry.key,
      id: entry.nodeId,
      kind: "file",
      label: entry.label,
      path: entry.path,
      status: entry.status,
    });
  }

  return finalizeDirectory(root).children;
}

export function sortDiffFileEntriesByTree(
  fileEntries: readonly DiffFileEntry[],
  explorerTree: readonly DiffExplorerNode[],
): DiffFileEntry[] {
  if (fileEntries.length < 2) {
    return [...fileEntries];
  }

  const entriesByKey = new Map(fileEntries.map((entry) => [entry.key, entry]));
  const orderedEntries: DiffFileEntry[] = [];

  const visit = (nodes: readonly DiffExplorerNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "directory") {
        visit(node.children);
        continue;
      }

      const entry = entriesByKey.get(node.fileKey);
      if (entry) {
        orderedEntries.push(entry);
      }
    }
  };

  visit(explorerTree);

  return orderedEntries.length === fileEntries.length
    ? orderedEntries
    : [...fileEntries];
}

export function reconcileSelectedDiffFileKey(
  selectedFileKey: string | null,
  fileEntries: readonly DiffFileEntry[],
): string | null {
  if (fileEntries.length === 0) {
    return null;
  }

  if (
    selectedFileKey &&
    fileEntries.some((entry) => entry.key === selectedFileKey)
  ) {
    return selectedFileKey;
  }

  return fileEntries[0]?.key ?? null;
}
