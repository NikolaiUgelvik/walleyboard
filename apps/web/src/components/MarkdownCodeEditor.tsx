import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import {
  EditorSelection,
  EditorState,
  RangeSetBuilder,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { Input, type InputWrapperProps } from "@mantine/core";
import { basicSetup } from "codemirror";
import { useEffect, useMemo, useRef } from "react";
import type { TicketReference } from "../../../../packages/contracts/src/index.js";

import {
  deriveMarkdownImageFilename,
  parseStandaloneMarkdownImageLine,
  splitMarkdownImageFilename,
} from "../lib/markdown-image-widget.js";

type MarkdownCodeEditorProps = {
  description?: string;
  id?: string;
  label: string;
  onChange: (value: string) => void;
  searchTicketReferences?: (query: string) => Promise<TicketReference[]>;
  uploadFile?: (file: File) => Promise<string>;
  value: string;
};

const ticketReferenceCompletionDebounceMs = 150;
class MarkdownImageWidget extends WidgetType {
  constructor(
    private readonly alt: string,
    private readonly src: string,
    private readonly rawMarkdown: string,
  ) {
    super();
  }

  eq(other: MarkdownImageWidget): boolean {
    return (
      this.alt === other.alt &&
      this.src === other.src &&
      this.rawMarkdown === other.rawMarkdown
    );
  }

  toDOM(): HTMLElement {
    const shell = document.createElement("div");
    shell.className = "walleyboard-markdown-image-widget";
    shell.setAttribute("aria-label", this.alt || "Pasted image");
    shell.title = this.rawMarkdown;

    const preview = document.createElement("img");
    preview.className = "walleyboard-markdown-image-widget__preview";
    preview.alt = this.alt;
    preview.loading = "lazy";
    preview.src = this.src;
    shell.append(preview);

    const meta = document.createElement("div");
    meta.className = "walleyboard-markdown-image-widget__meta";
    const filename = deriveMarkdownImageFilename(this.src);
    const { basename, extension } = splitMarkdownImageFilename(filename);
    meta.title = this.alt || filename;

    const title = document.createElement("span");
    title.className = "walleyboard-markdown-image-widget__title";
    title.textContent = basename;
    meta.append(title);

    if (extension.length > 0) {
      const extensionNode = document.createElement("span");
      extensionNode.className = "walleyboard-markdown-image-widget__extension";
      extensionNode.textContent = extension;
      meta.append(extensionNode);
    }

    shell.append(meta);
    return shell;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildMarkdownImageDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const parsedImage = parseStandaloneMarkdownImageLine(line.text);

    if (!parsedImage) {
      continue;
    }

    builder.add(
      line.from,
      line.to,
      Decoration.replace({
        inclusive: false,
        widget: new MarkdownImageWidget(
          parsedImage.alt,
          parsedImage.src,
          parsedImage.rawMarkdown,
        ),
      }),
    );
  }

  return builder.finish();
}

const markdownImageWidgetExtension = StateField.define<DecorationSet>({
  create(state) {
    return buildMarkdownImageDecorations(state);
  },
  update(decorations, transaction) {
    if (!transaction.docChanged) {
      return decorations.map(transaction.changes);
    }

    return buildMarkdownImageDecorations(transaction.state);
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});

export function buildMarkdownImageInsertion(
  value: string,
  markdownImage: string,
  selectionStart: number,
  selectionEnd: number,
): { cursorOffset: number; nextValue: string } {
  const prefix =
    selectionStart > 0 && !value.slice(0, selectionStart).endsWith("\n")
      ? "\n\n"
      : "";
  const suffix =
    selectionEnd < value.length && !value.slice(selectionEnd).startsWith("\n")
      ? "\n\n"
      : "";
  const insertedText = `${prefix}${markdownImage}${suffix}`;
  const nextValue =
    value.slice(0, selectionStart) + insertedText + value.slice(selectionEnd);
  const imageEndOffset = selectionStart + prefix.length + markdownImage.length;

  if (nextValue[imageEndOffset] !== "\n") {
    const visibleTail = "\n\n";
    return {
      cursorOffset: imageEndOffset + visibleTail.length,
      nextValue:
        nextValue.slice(0, imageEndOffset) +
        visibleTail +
        nextValue.slice(imageEndOffset),
    };
  }

  let cursorOffset = imageEndOffset;
  while (nextValue[cursorOffset] === "\n") {
    cursorOffset += 1;
  }

  return { cursorOffset, nextValue };
}

export function MarkdownCodeEditor({
  description,
  id,
  label,
  onChange,
  searchTicketReferences,
  uploadFile,
  value,
}: MarkdownCodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const initialValueRef = useRef(value);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const searchTicketReferencesRef = useRef(searchTicketReferences);
  const uploadFileRef = useRef(uploadFile);

  onChangeRef.current = onChange;
  searchTicketReferencesRef.current = searchTicketReferences;
  uploadFileRef.current = uploadFile;

  const editorAttributes = useMemo(() => {
    const attributes: Record<string, string> = {};

    if (id) {
      attributes.id = id;
      attributes["aria-labelledby"] = `${id}-label`;
      if (description) {
        attributes["aria-describedby"] = `${id}-description`;
      }
    }

    return attributes;
  }, [description, id]);

  useEffect(() => {
    if (!hostRef.current || viewRef.current) {
      return;
    }

    const ticketReferenceCompletionSource = (
      context: CompletionContext,
    ): Promise<CompletionResult | null> | null => {
      const match = context.matchBefore(/#[A-Za-z0-9_-]*/);
      if (!match || (match.from === match.to && !context.explicit)) {
        return null;
      }

      const search = searchTicketReferencesRef.current;
      if (!search) {
        return null;
      }

      return new Promise((resolve) => {
        let settled = false;
        const settle = (result: CompletionResult | null) => {
          if (settled) {
            return;
          }

          settled = true;
          resolve(result);
        };
        const timeoutId = globalThis.setTimeout(() => {
          void (async () => {
            try {
              const matches = await search(match.text.slice(1));
              if (context.aborted || matches.length === 0) {
                settle(null);
                return;
              }

              settle({
                filter: false,
                from: match.from,
                options: matches.map((reference) => ({
                  apply: `#${reference.ticket_id}`,
                  detail: reference.title,
                  info: reference.status.replace("_", " "),
                  label: `#${reference.ticket_id}`,
                  type: "keyword",
                })),
              });
            } catch {
              settle(null);
            }
          })();
        }, ticketReferenceCompletionDebounceMs);

        context.addEventListener(
          "abort",
          () => {
            globalThis.clearTimeout(timeoutId);
            settle(null);
          },
          { onDocChange: true },
        );
      });
    };

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          basicSetup,
          markdown(),
          EditorView.lineWrapping,
          markdownImageWidgetExtension,
          EditorView.contentAttributes.of(editorAttributes),
          autocompletion({
            icons: false,
            override: [ticketReferenceCompletionSource],
          }),
          EditorView.domEventHandlers({
            paste(event, currentView) {
              const imageItem = Array.from(
                event.clipboardData?.items ?? [],
              ).find((item) => item.type.startsWith("image/"));
              const file = imageItem?.getAsFile();
              const handleUpload = uploadFileRef.current;

              if (!file || !handleUpload) {
                return false;
              }

              const selection = currentView.state.selection.main;
              event.preventDefault();

              void (async () => {
                try {
                  const markdownImage = await handleUpload(file);
                  const insertion = buildMarkdownImageInsertion(
                    currentView.state.doc.toString(),
                    markdownImage,
                    selection.from,
                    selection.to,
                  );

                  currentView.dispatch({
                    changes: {
                      from: 0,
                      to: currentView.state.doc.length,
                      insert: insertion.nextValue,
                    },
                    selection: EditorSelection.cursor(insertion.cursorOffset),
                  });
                  currentView.focus();
                } catch {
                  // The upload flow already reports the error to the user.
                }
              })();

              return true;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) {
              return;
            }

            onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [editorAttributes]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const currentValue = view.state.doc.toString();
    if (currentValue === value) {
      return;
    }

    const nextCursor = Math.min(value.length, view.state.selection.main.head);
    view.dispatch({
      changes: {
        from: 0,
        to: currentValue.length,
        insert: value,
      },
      selection: EditorSelection.cursor(nextCursor),
    });
  }, [value]);

  const inputWrapperProps: InputWrapperProps = {
    className: "walleyboard-codemirror-field",
    label,
    size: "sm",
  };

  if (description !== undefined) {
    inputWrapperProps.description = description;
  }

  if (id !== undefined) {
    inputWrapperProps.id = id;
  }

  return (
    <Input.Wrapper {...inputWrapperProps}>
      <div className="walleyboard-codemirror" ref={hostRef} />
    </Input.Wrapper>
  );
}
