export type TicketReferenceMatch = {
  ticketId: number;
  start: number;
  end: number;
};

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /^[A-Za-z0-9_]$/.test(character);
}

function isLineStart(text: string, index: number): boolean {
  return index === 0 || text[index - 1] === "\n";
}

function skipWhitespace(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor] ?? "")) {
    cursor += 1;
  }

  return cursor;
}

function parseBracketSequence(
  text: string,
  index: number,
): { end: number } | null {
  if (text[index] !== "[") {
    return null;
  }

  let cursor = index + 1;
  let depth = 1;

  while (cursor < text.length) {
    const character = text[cursor];
    if (character === "\\") {
      cursor += Math.min(2, text.length - cursor);
      continue;
    }

    const inlineCodeEnd = consumeInlineCode(text, cursor);
    if (inlineCodeEnd !== null) {
      cursor = inlineCodeEnd;
      continue;
    }

    if (character === "[") {
      depth += 1;
      cursor += 1;
      continue;
    }

    if (character === "]") {
      depth -= 1;
      cursor += 1;
      if (depth === 0) {
        return { end: cursor };
      }
      continue;
    }

    cursor += 1;
  }

  return null;
}

function parseParenthesizedSequence(
  text: string,
  index: number,
): { end: number } | null {
  if (text[index] !== "(") {
    return null;
  }

  let cursor = index + 1;
  let depth = 1;

  while (cursor < text.length) {
    const character = text[cursor];
    if (character === "\\") {
      cursor += Math.min(2, text.length - cursor);
      continue;
    }

    const inlineCodeEnd = consumeInlineCode(text, cursor);
    if (inlineCodeEnd !== null) {
      cursor = inlineCodeEnd;
      continue;
    }

    if (character === "(") {
      depth += 1;
      cursor += 1;
      continue;
    }

    if (character === ")") {
      depth -= 1;
      cursor += 1;
      if (depth === 0) {
        return { end: cursor };
      }
      continue;
    }

    cursor += 1;
  }

  return null;
}

function consumeInlineCode(text: string, index: number): number | null {
  if (text[index] !== "`") {
    return null;
  }

  let fenceLength = 1;
  while (text[index + fenceLength] === "`") {
    fenceLength += 1;
  }

  const closingFence = "`".repeat(fenceLength);
  const closingIndex = text.indexOf(closingFence, index + fenceLength);
  if (closingIndex === -1) {
    return null;
  }

  return closingIndex + fenceLength;
}

function consumeFencedCodeBlock(text: string, index: number): number | null {
  if (!isLineStart(text, index)) {
    return null;
  }

  let cursor = index;
  let indent = 0;
  while (indent < 3 && text[cursor] === " ") {
    cursor += 1;
    indent += 1;
  }

  if (!text.startsWith("```", cursor)) {
    return null;
  }

  const lineEndIndex = text.indexOf("\n", cursor);
  if (lineEndIndex === -1) {
    return text.length;
  }

  let nextLineStart = lineEndIndex + 1;
  while (nextLineStart < text.length) {
    let lineCursor = nextLineStart;
    let lineIndent = 0;
    while (lineIndent < 3 && text[lineCursor] === " ") {
      lineCursor += 1;
      lineIndent += 1;
    }

    if (text.startsWith("```", lineCursor)) {
      const closingLineEnd = text.indexOf("\n", lineCursor);
      return closingLineEnd === -1 ? text.length : closingLineEnd + 1;
    }

    const nextLineBreak = text.indexOf("\n", nextLineStart);
    if (nextLineBreak === -1) {
      return text.length;
    }
    nextLineStart = nextLineBreak + 1;
  }

  return text.length;
}

function consumeMarkdownLinkOrImage(
  text: string,
  index: number,
): number | null {
  const isImage = text[index] === "!" && text[index + 1] === "[";
  if (!isImage && text[index] !== "[") {
    return null;
  }

  const labelStart = isImage ? index + 1 : index;
  const label = parseBracketSequence(text, labelStart);
  if (!label) {
    return null;
  }

  const destinationStart = skipWhitespace(text, label.end);
  const destinationCharacter = text[destinationStart];

  if (destinationCharacter === "(") {
    const destination = parseParenthesizedSequence(text, destinationStart);
    return destination?.end ?? null;
  }

  if (destinationCharacter === "[") {
    const reference = parseBracketSequence(text, destinationStart);
    return reference?.end ?? null;
  }

  return null;
}

function consumeAutolink(text: string, index: number): number | null {
  if (text[index] !== "<") {
    return null;
  }

  const closingIndex = text.indexOf(">", index + 1);
  if (closingIndex === -1) {
    return null;
  }

  const content = text.slice(index + 1, closingIndex);
  if (!/^(https?:\/\/|mailto:)[^\s<>]+$/i.test(content)) {
    return null;
  }

  return closingIndex + 1;
}

function consumeBareUrl(text: string, index: number): number | null {
  if (
    !text.startsWith("http://", index) &&
    !text.startsWith("https://", index)
  ) {
    return null;
  }

  const match = /^https?:\/\/[^\s<]+/i.exec(text.slice(index));
  return match ? index + match[0].length : null;
}

function consumeMarkdownReferenceDefinition(
  text: string,
  index: number,
): number | null {
  if (!isLineStart(text, index)) {
    return null;
  }

  let cursor = index;
  let indent = 0;
  while (indent < 3 && text[cursor] === " ") {
    cursor += 1;
    indent += 1;
  }

  const label = parseBracketSequence(text, cursor);
  if (!label) {
    return null;
  }

  cursor = label.end;
  while (text[cursor] === " " || text[cursor] === "\t") {
    cursor += 1;
  }

  if (text[cursor] !== ":") {
    return null;
  }

  const lineEndIndex = text.indexOf("\n", cursor);
  return lineEndIndex === -1 ? text.length : lineEndIndex + 1;
}

function consumeTicketReference(
  text: string,
  index: number,
): TicketReferenceMatch | null {
  if (text[index] !== "#" || isWordCharacter(text[index - 1])) {
    return null;
  }

  const firstDigit = text[index + 1];
  if (firstDigit === undefined || !/^[1-9]$/.test(firstDigit)) {
    return null;
  }

  let cursor = index + 2;
  while (/^\d$/.test(text[cursor] ?? "")) {
    cursor += 1;
  }

  if (isWordCharacter(text[cursor])) {
    return null;
  }

  return {
    ticketId: Number(text.slice(index + 1, cursor)),
    start: index,
    end: cursor,
  };
}

export function findTicketReferenceMatches(
  text: string,
): TicketReferenceMatch[] {
  const matches: TicketReferenceMatch[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const fencedCodeEnd = consumeFencedCodeBlock(text, cursor);
    if (fencedCodeEnd !== null) {
      cursor = fencedCodeEnd;
      continue;
    }

    const referenceDefinitionEnd = consumeMarkdownReferenceDefinition(
      text,
      cursor,
    );
    if (referenceDefinitionEnd !== null) {
      cursor = referenceDefinitionEnd;
      continue;
    }

    const markdownLinkEnd = consumeMarkdownLinkOrImage(text, cursor);
    if (markdownLinkEnd !== null) {
      cursor = markdownLinkEnd;
      continue;
    }

    const autolinkEnd = consumeAutolink(text, cursor);
    if (autolinkEnd !== null) {
      cursor = autolinkEnd;
      continue;
    }

    const bareUrlEnd = consumeBareUrl(text, cursor);
    if (bareUrlEnd !== null) {
      cursor = bareUrlEnd;
      continue;
    }

    const inlineCodeEnd = consumeInlineCode(text, cursor);
    if (inlineCodeEnd !== null) {
      cursor = inlineCodeEnd;
      continue;
    }

    if (text[cursor] === "\\") {
      cursor += Math.min(2, text.length - cursor);
      continue;
    }

    const reference = consumeTicketReference(text, cursor);
    if (reference) {
      matches.push(reference);
      cursor = reference.end;
      continue;
    }

    cursor += 1;
  }

  return matches;
}

export function collectTicketReferenceIds(texts: string[]): number[] {
  const seenIds = new Set<number>();
  const referenceIds: number[] = [];

  for (const text of texts) {
    for (const match of findTicketReferenceMatches(text)) {
      if (seenIds.has(match.ticketId)) {
        continue;
      }

      seenIds.add(match.ticketId);
      referenceIds.push(match.ticketId);
    }
  }

  return referenceIds;
}
