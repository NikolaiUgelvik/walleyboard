import assert from "node:assert/strict";
import test from "node:test";

import { QueryClient } from "@tanstack/react-query";
import { JSDOM } from "jsdom";

import { createDraftEditorController } from "./draft-editor-controller.js";

function installGlobal(name: string, value: unknown): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  });

  return () => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, name, originalDescriptor);
      return;
    }

    Reflect.deleteProperty(globalThis, name);
  };
}

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const { window } = dom;
  const restoreGlobals = [
    installGlobal("window", window),
    installGlobal("document", window.document),
    installGlobal("File", window.File),
    installGlobal("FileReader", window.FileReader),
  ];

  return {
    cleanup: () => {
      for (const restore of restoreGlobals.reverse()) {
        restore();
      }
      dom.window.close();
    },
    window,
  };
}

test("uploadDraftEditorImage uploads pasted images and updates the shared artifact scope", async () => {
  const dom = installDom();

  try {
    let nextArtifactScopeId: string | null = null;
    const uploadErrorCalls: Array<string | null> = [];
    let uploadInput: {
      artifactScopeId: string | null;
      dataBase64: string;
      mimeType: string;
      projectId: string;
    } | null = null;

    const controller = createDraftEditorController({
      createDraftMutation: {
        mutateAsync: async () => ({ resource_refs: undefined }),
      },
      draftEditorAcceptanceCriteria: "",
      draftEditorArtifactScopeId: null,
      draftEditorDescription: "Description",
      draftEditorProjectId: "project-1",
      draftEditorTicketType: "feature",
      draftEditorTitle: "Title",
      queryClient: new QueryClient(),
      setDraftEditorAcceptanceCriteria: () => {},
      setDraftEditorArtifactScopeId: (value) => {
        nextArtifactScopeId = value;
      },
      setDraftEditorDescription: () => {},
      setDraftEditorProjectId: () => {},
      setDraftEditorSourceId: () => {},
      setDraftEditorTicketType: () => {},
      setDraftEditorTitle: () => {},
      setDraftEditorUploadError: (value) => {
        uploadErrorCalls.push(value);
      },
      setPendingDraftEditorSync: () => {},
      setPendingNewDraftAction: () => {},
      uploadDraftArtifactMutation: {
        mutateAsync: async (input) => {
          uploadInput = input;
          return {
            artifact_scope_id: "artifact-scope-2",
            artifact_url:
              "/projects/project-1/draft-artifacts/artifact-scope-2/clip.png",
            markdown_image:
              "![clip]( /projects/project-1/draft-artifacts/artifact-scope-2/clip.png )",
          };
        },
      },
    });

    const file = new dom.window.File(["hello"], "clip.png", {
      type: "image/png",
    });
    const artifactUrl = await controller.uploadDraftEditorImage(file);

    assert.equal(
      artifactUrl,
      "![clip]( /projects/project-1/draft-artifacts/artifact-scope-2/clip.png )",
    );
    assert.deepEqual(uploadInput, {
      artifactScopeId: null,
      dataBase64: "aGVsbG8=",
      mimeType: "image/png",
      projectId: "project-1",
    });
    assert.equal(nextArtifactScopeId, "artifact-scope-2");
    assert.deepEqual(uploadErrorCalls, [null]);
  } finally {
    dom.cleanup();
  }
});

test("sequential uploadDraftEditorImage calls reuse the latest artifact scope", async () => {
  const dom = installDom();

  try {
    const artifactScopeIds: Array<string | null> = [];
    let uploadCount = 0;

    const controller = createDraftEditorController({
      createDraftMutation: {
        mutateAsync: async () => ({ resource_refs: undefined }),
      },
      draftEditorAcceptanceCriteria: "",
      draftEditorArtifactScopeId: null,
      draftEditorDescription: "Description",
      draftEditorProjectId: "project-1",
      draftEditorTicketType: "feature",
      draftEditorTitle: "Title",
      queryClient: new QueryClient(),
      setDraftEditorAcceptanceCriteria: () => {},
      setDraftEditorArtifactScopeId: () => {},
      setDraftEditorDescription: () => {},
      setDraftEditorProjectId: () => {},
      setDraftEditorSourceId: () => {},
      setDraftEditorTicketType: () => {},
      setDraftEditorTitle: () => {},
      setDraftEditorUploadError: () => {},
      setPendingDraftEditorSync: () => {},
      setPendingNewDraftAction: () => {},
      uploadDraftArtifactMutation: {
        mutateAsync: async (input) => {
          artifactScopeIds.push(input.artifactScopeId);
          uploadCount += 1;

          return {
            artifact_scope_id: "artifact-scope-2",
            artifact_url: `/projects/project-1/draft-artifacts/artifact-scope-2/clip-${uploadCount}.png`,
            markdown_image: `![clip-${uploadCount}]( /projects/project-1/draft-artifacts/artifact-scope-2/clip-${uploadCount}.png )`,
          };
        },
      },
    });

    const firstFile = new dom.window.File(["first"], "clip-1.png", {
      type: "image/png",
    });
    const secondFile = new dom.window.File(["second"], "clip-2.png", {
      type: "image/png",
    });

    await controller.uploadDraftEditorImage(firstFile);
    await controller.uploadDraftEditorImage(secondFile);

    assert.deepEqual(artifactScopeIds, [null, "artifact-scope-2"]);
  } finally {
    dom.cleanup();
  }
});
