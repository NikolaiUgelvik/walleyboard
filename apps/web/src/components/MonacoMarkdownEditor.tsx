import { Box, Loader, Stack, Text, Textarea } from "@mantine/core";
import { useMantineColorScheme } from "@mantine/core";
import { useEffect, useRef, useState } from "react";

const MONACO_BASE_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs";
const MONACO_LOADER_URL = `${MONACO_BASE_URL}/loader.min.js`;
const MONACO_CSS_URL = `${MONACO_BASE_URL}/editor/editor.main.css`;

type MonacoDisposable = {
  dispose(): void;
};

type MonacoPosition = {
  lineNumber: number;
  column: number;
};

type MonacoSelection = {
  getStartPosition(): MonacoPosition;
  getEndPosition(): MonacoPosition;
};

type MonacoTextModel = {
  getValue(): string;
  setValue(value: string): void;
  getOffsetAt(position: MonacoPosition): number;
  getPositionAt(offset: number): MonacoPosition;
};

type MonacoRangeLike = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

type MonacoStandaloneCodeEditor = {
  dispose(): void;
  focus(): void;
  getDomNode(): HTMLElement | null;
  getModel(): MonacoTextModel | null;
  getSelection(): MonacoSelection | null;
  onDidChangeModelContent(listener: () => void): MonacoDisposable;
  setSelection(selection: MonacoRangeLike): void;
};

type MonacoEditorNamespace = {
  create(
    container: HTMLElement,
    options: Record<string, unknown>,
  ): MonacoStandaloneCodeEditor;
  setTheme(theme: string): void;
};

type MonacoNamespace = {
  editor: MonacoEditorNamespace;
};

type MonacoAmdRequire = {
  (dependencies: string[], callback: () => void): void;
  config(options: { paths: Record<string, string> }): void;
};

declare global {
  interface Window {
    monaco?: MonacoNamespace;
    require?: MonacoAmdRequire;
  }
}

let monacoLoaderPromise: Promise<MonacoNamespace> | null = null;

function ensureMonacoStylesheet(): void {
  if (
    document.querySelector(`link[data-orchestrator-monaco="true"]`) !== null
  ) {
    return;
  }

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = MONACO_CSS_URL;
  link.dataset.orchestratorMonaco = "true";
  document.head.append(link);
}

function loadMonaco(): Promise<MonacoNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("Monaco is unavailable during server render."),
    );
  }

  if (window.monaco) {
    return Promise.resolve(window.monaco);
  }

  if (monacoLoaderPromise) {
    return monacoLoaderPromise;
  }

  monacoLoaderPromise = new Promise<MonacoNamespace>((resolve, reject) => {
    ensureMonacoStylesheet();

    const loadEditor = (): void => {
      const amdRequire = window.require;
      if (!amdRequire) {
        reject(new Error("Monaco loader is unavailable."));
        return;
      }

      amdRequire.config({
        paths: {
          vs: MONACO_BASE_URL,
        },
      });
      amdRequire(["vs/editor/editor.main"], () => {
        if (!window.monaco) {
          reject(new Error("Monaco failed to initialize."));
          return;
        }

        resolve(window.monaco);
      });
    };

    const existingLoader = document.querySelector<HTMLScriptElement>(
      `script[data-orchestrator-monaco-loader="true"]`,
    );
    if (existingLoader) {
      if (typeof window.require === "function") {
        loadEditor();
        return;
      }

      existingLoader.addEventListener("load", loadEditor, { once: true });
      existingLoader.addEventListener(
        "error",
        () => reject(new Error("Unable to load Monaco.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = MONACO_LOADER_URL;
    script.async = true;
    script.dataset.orchestratorMonacoLoader = "true";
    script.addEventListener("load", loadEditor, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Unable to load Monaco.")),
      { once: true },
    );
    document.head.append(script);
  }).catch((error) => {
    monacoLoaderPromise = null;
    throw error;
  });

  return monacoLoaderPromise;
}

type MonacoMarkdownEditorProps = {
  description?: string;
  id: string;
  label: string;
  minHeight?: number;
  onChange(value: string): void;
  onImagePaste?(
    file: File,
    selection: { start: number; end: number },
  ): Promise<{ cursorOffset: number; value: string } | null>;
  placeholder?: string;
  required?: boolean;
  value: string;
};

export function MonacoMarkdownEditor({
  description,
  id,
  label,
  minHeight = 208,
  onChange,
  onImagePaste,
  placeholder,
  required = false,
  value,
}: MonacoMarkdownEditorProps) {
  const { colorScheme } = useMantineColorScheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoStandaloneCodeEditor | null>(null);
  const latestValueRef = useRef(value);
  const pasteHandlerRef = useRef(onImagePaste);
  const pendingSelectionOffsetRef = useRef<number | null>(null);
  const [monacoReady, setMonacoReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  latestValueRef.current = value;
  pasteHandlerRef.current = onImagePaste;

  useEffect(() => {
    let active = true;
    let contentSubscription: MonacoDisposable | null = null;
    let pasteListenerCleanup: (() => void) | null = null;

    setMonacoReady(false);

    const createEditor = async (): Promise<void> => {
      if (!containerRef.current) {
        return;
      }

      try {
        const monaco = await loadMonaco();
        if (!active || !containerRef.current) {
          return;
        }

        monaco.editor.setTheme(colorScheme === "dark" ? "vs-dark" : "vs");
        const editor = monaco.editor.create(containerRef.current, {
          ariaLabel: label,
          automaticLayout: true,
          glyphMargin: false,
          language: "markdown",
          lineDecorationsWidth: 0,
          lineNumbers: "off",
          lineNumbersMinChars: 0,
          minimap: { enabled: false },
          overviewRulerLanes: 0,
          padding: { top: 12, bottom: 12 },
          placeholder,
          renderLineHighlight: "none",
          scrollBeyondLastLine: false,
          value: latestValueRef.current,
          wordWrap: "on",
          wrappingIndent: "same",
        });
        editorRef.current = editor;
        contentSubscription = editor.onDidChangeModelContent(() => {
          const model = editor.getModel();
          if (!model) {
            return;
          }

          const nextValue = model.getValue();
          latestValueRef.current = nextValue;
          onChange(nextValue);
        });

        const handlePaste = (event: ClipboardEvent): void => {
          const imagePasteHandler = pasteHandlerRef.current;
          if (!imagePasteHandler || !event.clipboardData) {
            return;
          }

          const imageItem = Array.from(event.clipboardData.items).find((item) =>
            item.type.startsWith("image/"),
          );
          if (!imageItem) {
            return;
          }

          const file = imageItem.getAsFile();
          const model = editor.getModel();
          const selection = editor.getSelection();
          if (!file || !model || !selection) {
            return;
          }

          event.preventDefault();
          const start = model.getOffsetAt(selection.getStartPosition());
          const end = model.getOffsetAt(selection.getEndPosition());
          void (async () => {
            const result = await imagePasteHandler(file, { start, end });
            if (!result) {
              return;
            }

            pendingSelectionOffsetRef.current = result.cursorOffset;
            latestValueRef.current = result.value;
            onChange(result.value);
          })();
        };

        const domNode = editor.getDomNode();
        if (domNode) {
          domNode.addEventListener("paste", handlePaste, true);
          pasteListenerCleanup = () => {
            domNode.removeEventListener("paste", handlePaste, true);
          };
        }

        if (active) {
          setMonacoReady(true);
          setLoadFailed(false);
        }
      } catch {
        if (active) {
          setLoadFailed(true);
        }
      }
    };

    void createEditor();

    return () => {
      active = false;
      contentSubscription?.dispose();
      pasteListenerCleanup?.();
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, [colorScheme, label, onChange, placeholder]);

  useEffect(() => {
    if (!monacoReady) {
      return;
    }

    const model = editorRef.current?.getModel();
    if (!model || model.getValue() === value) {
      return;
    }

    model.setValue(value);
    const pendingSelectionOffset = pendingSelectionOffsetRef.current;
    if (pendingSelectionOffset === null) {
      return;
    }

    pendingSelectionOffsetRef.current = null;
    const position = model.getPositionAt(pendingSelectionOffset);
    editorRef.current?.setSelection({
      startLineNumber: position.lineNumber,
      startColumn: position.column,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    });
    editorRef.current?.focus();
  }, [monacoReady, value]);

  useEffect(() => {
    if (!monacoReady) {
      return;
    }

    editorRef.current?.focus();
  }, [monacoReady]);

  return (
    <Stack gap="xs">
      <Text component="label" fw={500} htmlFor={id} size="sm">
        {label}
        {required ? " *" : ""}
      </Text>
      {description ? (
        <Text id={`${id}-description`} size="sm" c="dimmed">
          {description}
        </Text>
      ) : null}
      {loadFailed ? (
        <Textarea
          id={id}
          minRows={8}
          placeholder={placeholder}
          required={required}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          onPaste={(event) => {
            const imagePasteHandler = pasteHandlerRef.current;
            if (!imagePasteHandler) {
              return;
            }

            const imageItem = Array.from(event.clipboardData.items).find(
              (item) => item.type.startsWith("image/"),
            );
            if (!imageItem) {
              return;
            }

            const file = imageItem.getAsFile();
            if (!file) {
              return;
            }

            event.preventDefault();
            void (async () => {
              const result = await imagePasteHandler(file, {
                start: event.currentTarget.selectionStart,
                end: event.currentTarget.selectionEnd,
              });
              if (!result) {
                return;
              }

              const target = event.currentTarget;
              onChange(result.value);
              window.requestAnimationFrame(() => {
                target.selectionStart = result.cursorOffset;
                target.selectionEnd = result.cursorOffset;
                target.focus();
              });
            })();
          }}
        />
      ) : (
        <Box className="monaco-markdown-editor" style={{ minHeight }}>
          {!monacoReady ? <GroupOverlay /> : null}
          <Box
            id={id}
            ref={containerRef}
            aria-describedby={description ? `${id}-description` : undefined}
            className="monaco-markdown-editor__surface"
            style={{ minHeight }}
          />
        </Box>
      )}
    </Stack>
  );
}

function GroupOverlay() {
  return (
    <Stack
      gap="xs"
      align="center"
      justify="center"
      className="monaco-markdown-editor__loading"
    >
      <Loader size="sm" />
      <Text size="sm" c="dimmed">
        Loading editor...
      </Text>
    </Stack>
  );
}
