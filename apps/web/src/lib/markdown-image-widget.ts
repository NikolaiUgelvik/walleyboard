import { resolveProjectArtifactHref } from "./api-base-url.js";

export type MarkdownImageWidgetMatch = {
  alt: string;
  rawMarkdown: string;
  src: string;
};

const standaloneMarkdownImagePattern =
  /^!\[(?<alt>[^\]]*)\]\(\s*(?<src>[^)\s]+)\s*\)$/;

function isSafeImageHref(href: string): boolean {
  if (href.startsWith("/")) {
    return true;
  }

  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function deriveMarkdownImageFilename(src: string): string {
  try {
    const url = new URL(src);
    const pathnameParts = url.pathname.split("/").filter(Boolean);
    return pathnameParts.at(-1) ?? src;
  } catch {
    return src.split("/").filter(Boolean).at(-1) ?? src;
  }
}

export function splitMarkdownImageFilename(filename: string): {
  basename: string;
  extension: string;
} {
  const extensionIndex = filename.lastIndexOf(".");
  const hasExtension =
    extensionIndex > 0 && extensionIndex < filename.length - 1;

  if (!hasExtension) {
    return {
      basename: filename,
      extension: "",
    };
  }

  return {
    basename: filename.slice(0, extensionIndex),
    extension: filename.slice(extensionIndex),
  };
}

export function parseStandaloneMarkdownImageLine(
  line: string,
): MarkdownImageWidgetMatch | null {
  const trimmedLine = line.trim();
  const match = trimmedLine.match(standaloneMarkdownImagePattern);
  const alt = match?.groups?.alt;
  const src = match?.groups?.src;

  if (alt === undefined || src === undefined || !isSafeImageHref(src)) {
    return null;
  }

  return {
    alt,
    rawMarkdown: trimmedLine,
    src: resolveProjectArtifactHref(src),
  };
}
