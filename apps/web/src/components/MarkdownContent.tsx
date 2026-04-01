import React, { Fragment } from "react";
import type { ReactNode } from "react";

import { resolveProjectArtifactHref } from "../lib/api-base-url.js";

type MarkdownContentProps = {
  content: string;
  inline?: boolean;
  className?: string;
};

type MarkdownBlock =
  | {
      type: "heading";
      level: 1 | 2 | 3 | 4 | 5 | 6;
      content: string;
    }
  | {
      type: "paragraph";
      content: string;
    }
  | {
      type: "unordered-list" | "ordered-list";
      items: string[];
    }
  | {
      type: "blockquote";
      content: string;
    }
  | {
      type: "code";
      language: string | null;
      content: string;
    };

const inlineTokenPattern =
  /!\[(?<imageText>[^\]]*)\]\((?<imageHref>[^)\s]+)\)|\[(?<linkText>[^\]]+)\]\((?<linkHref>[^)\s]+)\)|`(?<code>[^`]+)`|(?<!\*)\*\*(?<strongA>[\s\S]+?)\*\*(?!\*)|(?<![A-Za-z0-9_])__(?<strongB>[\s\S]+?)__(?![A-Za-z0-9_])|(?<!\*)\*(?<emA>[^*\n]+)\*(?!\*)|(?<![A-Za-z0-9_])_(?<emB>[^_\n]+)_(?![A-Za-z0-9_])/g;

function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

function parseHeading(line: string): MarkdownBlock | null {
  const match = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
  if (!match) {
    return null;
  }

  const level = (match[1] ?? "#").length as 1 | 2 | 3 | 4 | 5 | 6;

  return {
    type: "heading",
    level,
    content: match[2] ?? "",
  };
}

function parseFence(line: string): { language: string | null } | null {
  const match = line.match(/^```([A-Za-z0-9_-]+)?\s*$/);
  if (!match) {
    return null;
  }

  return {
    language: match[1] ?? null,
  };
}

function parseListItem(
  line: string,
  type: "unordered-list" | "ordered-list",
): string | null {
  const match =
    type === "unordered-list"
      ? line.match(/^\s{0,3}[-+*]\s+(.*)$/)
      : line.match(/^\s{0,3}\d+\.\s+(.*)$/);

  return match?.[1] ?? null;
}

function isBlockStart(line: string): boolean {
  return (
    parseHeading(line) !== null ||
    parseFence(line) !== null ||
    parseListItem(line, "unordered-list") !== null ||
    parseListItem(line, "ordered-list") !== null ||
    /^\s{0,3}>\s?/.test(line)
  );
}

function parseBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (isBlankLine(line)) {
      index += 1;
      continue;
    }

    const fence = parseFence(line);
    if (fence) {
      index += 1;
      const codeLines: string[] = [];

      while (index < lines.length && parseFence(lines[index] ?? "") === null) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push({
        type: "code",
        language: fence.language,
        content: codeLines.join("\n"),
      });
      continue;
    }

    const heading = parseHeading(line);
    if (heading) {
      blocks.push(heading);
      index += 1;
      continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const currentLine = lines[index] ?? "";
        const quoteMatch = currentLine.match(/^\s{0,3}>\s?(.*)$/);
        if (!quoteMatch) {
          break;
        }

        quoteLines.push(quoteMatch[1] ?? "");
        index += 1;
      }

      blocks.push({
        type: "blockquote",
        content: quoteLines.join("\n"),
      });
      continue;
    }

    const unorderedItem = parseListItem(line, "unordered-list");
    const orderedItem = parseListItem(line, "ordered-list");
    const listType =
      unorderedItem !== null
        ? "unordered-list"
        : orderedItem !== null
          ? "ordered-list"
          : null;
    if (listType) {
      const items: string[] = [];

      while (index < lines.length) {
        const currentLine = lines[index] ?? "";
        const listItem = parseListItem(currentLine, listType);
        if (listItem !== null) {
          items.push(listItem);
          index += 1;
          continue;
        }

        if (
          items.length > 0 &&
          currentLine.trim().length > 0 &&
          /^\s{2,}/.test(currentLine)
        ) {
          items[items.length - 1] += `\n${currentLine.trim()}`;
          index += 1;
          continue;
        }

        break;
      }

      blocks.push({
        type: listType,
        items,
      });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const currentLine = lines[index] ?? "";
      if (isBlankLine(currentLine) || isBlockStart(currentLine)) {
        break;
      }

      paragraphLines.push(currentLine);
      index += 1;
    }

    blocks.push({
      type: "paragraph",
      content: paragraphLines.join("\n"),
    });
  }

  return blocks;
}

function sanitizeHref(href: string): string | null {
  if (href.length === 0) {
    return null;
  }

  if (!/^[A-Za-z][A-Za-z\d+.-]*:/.test(href)) {
    return href;
  }

  const protocol = href.slice(0, href.indexOf(":")).toLowerCase();
  if (protocol === "http" || protocol === "https" || protocol === "mailto") {
    return href;
  }

  return null;
}

function isExternalHref(href: string): boolean {
  return href.startsWith("http://") || href.startsWith("https://");
}

function renderInlineSegments(content: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let matchIndex = 0;

  for (const match of content.matchAll(inlineTokenPattern)) {
    if (match.index === undefined) {
      continue;
    }

    if (match.index > lastIndex) {
      nodes.push(content.slice(lastIndex, match.index));
    }

    const key = `${keyPrefix}-${matchIndex}`;
    const groups = match.groups ?? {};

    if (groups.imageHref !== undefined) {
      const safeSrc = sanitizeHref(groups.imageHref);
      if (!safeSrc) {
        nodes.push(match[0]);
      } else {
        const resolvedSrc = resolveProjectArtifactHref(safeSrc);
        nodes.push(
          <img
            key={key}
            alt={groups.imageText ?? ""}
            loading="lazy"
            src={resolvedSrc}
          />,
        );
      }
    } else if (groups.linkHref && groups.linkText) {
      const safeHref = sanitizeHref(groups.linkHref);
      if (!safeHref) {
        nodes.push(match[0]);
      } else {
        const resolvedHref = resolveProjectArtifactHref(safeHref);
        nodes.push(
          <a
            key={key}
            href={resolvedHref}
            rel={isExternalHref(resolvedHref) ? "noreferrer" : undefined}
            target={isExternalHref(resolvedHref) ? "_blank" : undefined}
          >
            {renderInline(groups.linkText, `${key}-link`)}
          </a>,
        );
      }
    } else if (groups.code !== undefined) {
      nodes.push(<code key={key}>{groups.code}</code>);
    } else if (groups.strongA || groups.strongB) {
      nodes.push(
        <strong key={key}>
          {renderInline(
            groups.strongA ?? groups.strongB ?? "",
            `${key}-strong`,
          )}
        </strong>,
      );
    } else if (groups.emA || groups.emB) {
      nodes.push(
        <em key={key}>
          {renderInline(groups.emA ?? groups.emB ?? "", `${key}-em`)}
        </em>,
      );
    } else {
      nodes.push(match[0]);
    }

    lastIndex = match.index + match[0].length;
    matchIndex += 1;
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }

  return nodes;
}

function renderInline(content: string, keyPrefix: string): ReactNode[] {
  const lines = content.split("\n");
  const nodes: ReactNode[] = [];

  for (const [index, line] of lines.entries()) {
    if (index > 0) {
      nodes.push(<br key={`${keyPrefix}-break-${index}`} />);
    }

    nodes.push(
      <Fragment key={`${keyPrefix}-line-${index}`}>
        {renderInlineSegments(line, `${keyPrefix}-line-${index}`)}
      </Fragment>,
    );
  }

  return nodes;
}

function renderListItem(item: string, key: string): ReactNode {
  const blocks = parseBlocks(item);
  if (blocks.length === 1 && blocks[0]?.type === "paragraph") {
    return renderInline(blocks[0].content, `${key}-paragraph`);
  }

  return renderBlocks(blocks, `${key}-nested`);
}

function renderListItems(
  items: string[],
  keyPrefix: string,
): Array<{ key: string; item: string }> {
  const seenItems = new Map<string, number>();

  return items.map((item) => {
    const occurrence = seenItems.get(item) ?? 0;
    seenItems.set(item, occurrence + 1);

    return {
      key: `${keyPrefix}-item-${item}-${occurrence}`,
      item,
    };
  });
}

function renderBlocks(blocks: MarkdownBlock[], keyPrefix: string): ReactNode[] {
  return blocks.map((block, index) => {
    const key = `${keyPrefix}-${index}`;

    switch (block.type) {
      case "heading": {
        const HeadingTag = `h${block.level}` as const;
        return (
          <HeadingTag key={key}>
            {renderInline(block.content, `${key}-heading`)}
          </HeadingTag>
        );
      }
      case "paragraph":
        return (
          <p key={key}>{renderInline(block.content, `${key}-paragraph`)}</p>
        );
      case "unordered-list":
        return (
          <ul key={key}>
            {renderListItems(block.items, key).map((item) => (
              <li key={item.key}>{renderListItem(item.item, item.key)}</li>
            ))}
          </ul>
        );
      case "ordered-list":
        return (
          <ol key={key}>
            {renderListItems(block.items, key).map((item) => (
              <li key={item.key}>{renderListItem(item.item, item.key)}</li>
            ))}
          </ol>
        );
      case "blockquote":
        return (
          <blockquote key={key}>
            {renderBlocks(parseBlocks(block.content), `${key}-quote`)}
          </blockquote>
        );
      case "code":
        return (
          <pre key={key}>
            <code data-language={block.language ?? undefined}>
              {block.content}
            </code>
          </pre>
        );
    }
  });
}

export function MarkdownContent({
  content,
  inline = false,
  className,
}: MarkdownContentProps) {
  if (content.length === 0) {
    return null;
  }

  const classes = ["markdown-content", inline ? "markdown-content--inline" : ""]
    .filter(Boolean)
    .concat(className ?? [])
    .join(" ");

  if (inline) {
    return <span className={classes}>{renderInline(content, "inline")}</span>;
  }

  return (
    <div className={classes}>{renderBlocks(parseBlocks(content), "block")}</div>
  );
}
