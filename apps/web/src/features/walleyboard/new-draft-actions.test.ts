import assert from "node:assert/strict";
import test from "node:test";

import type {
  Project,
  RepositoryConfig,
} from "../../../../../packages/contracts/src/index.js";

import { createNewDraftActionHandlers } from "./new-draft-actions.js";

const stubProject = { id: "project-1" } as Project;
const stubRepository = { id: "repo-1" } as RepositoryConfig;

function buildHandlerInput(overrides?: {
  persistNewDraftFromEditor?: (action: string) => Promise<string | null>;
  onRefineDraft?: (draftId: string) => Promise<void>;
  onQuestionDraft?: (draftId: string) => Promise<void>;
  onConfirmDraft?: (input: {
    acceptanceCriteria: string[];
    description: string;
    draftId: string;
    project: Project;
    repository: RepositoryConfig;
    ticketType: string | null;
    title: string;
  }) => Promise<void>;
}) {
  const actionCalls: Array<string | null> = [];
  return {
    actionCalls,
    input: {
      draftEditorAcceptanceCriteriaLines: [],
      draftEditorDescription: "Desc",
      draftEditorProject: stubProject,
      draftEditorRepository: stubRepository,
      draftEditorTicketType: "feature",
      draftEditorTitle: "Title",
      onConfirmDraft: overrides?.onConfirmDraft ?? (async () => {}),
      onQuestionDraft: overrides?.onQuestionDraft ?? (async () => {}),
      onRefineDraft: overrides?.onRefineDraft ?? (async () => {}),
      persistNewDraftFromEditor:
        overrides?.persistNewDraftFromEditor ?? (async () => "draft-1"),
      setPendingNewDraftAction: (value: string | null) => {
        actionCalls.push(value);
      },
    },
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

test("handleRefineNewDraft keeps pendingNewDraftAction set until refine mutation completes", async () => {
  let resolveRefine!: () => void;
  const refinePromise = new Promise<void>((resolve) => {
    resolveRefine = resolve;
  });

  const { actionCalls, input } = buildHandlerInput({
    onRefineDraft: () => refinePromise,
  });

  const { handleRefineNewDraft } = createNewDraftActionHandlers(input);
  handleRefineNewDraft();

  await flushMicrotasks();
  assert.deepEqual(actionCalls, []);

  resolveRefine();
  await flushMicrotasks();
  assert.deepEqual(actionCalls, [null]);
});

test("handleRefineNewDraft clears pendingNewDraftAction when refine mutation rejects", async () => {
  const { actionCalls, input } = buildHandlerInput({
    onRefineDraft: async () => {
      throw new Error("refine failed");
    },
  });

  const { handleRefineNewDraft } = createNewDraftActionHandlers(input);
  handleRefineNewDraft();

  await flushMicrotasks();
  assert.deepEqual(actionCalls, [null]);
});

test("handleRefineNewDraft does not call onRefineDraft when persist returns null", async () => {
  const refineCalls: string[] = [];
  const { actionCalls, input } = buildHandlerInput({
    persistNewDraftFromEditor: async () => null,
    onRefineDraft: async (draftId) => {
      refineCalls.push(draftId);
    },
  });

  const { handleRefineNewDraft } = createNewDraftActionHandlers(input);
  handleRefineNewDraft();

  await flushMicrotasks();
  assert.deepEqual(refineCalls, []);
  assert.deepEqual(actionCalls, []);
});

test("handleQuestionNewDraft clears pendingNewDraftAction after question mutation completes", async () => {
  let resolveQuestion!: () => void;
  const questionPromise = new Promise<void>((resolve) => {
    resolveQuestion = resolve;
  });

  const { actionCalls, input } = buildHandlerInput({
    onQuestionDraft: () => questionPromise,
  });

  const { handleQuestionNewDraft } = createNewDraftActionHandlers(input);
  handleQuestionNewDraft();

  await flushMicrotasks();
  assert.deepEqual(actionCalls, []);

  resolveQuestion();
  await flushMicrotasks();
  assert.deepEqual(actionCalls, [null]);
});

test("handleConfirmNewDraft clears pendingNewDraftAction after confirm mutation completes", async () => {
  let resolveConfirm!: () => void;
  const confirmPromise = new Promise<void>((resolve) => {
    resolveConfirm = resolve;
  });

  const { actionCalls, input } = buildHandlerInput({
    onConfirmDraft: () => confirmPromise,
  });

  const { handleConfirmNewDraft } = createNewDraftActionHandlers(input);
  handleConfirmNewDraft();

  await flushMicrotasks();
  assert.deepEqual(actionCalls, []);

  resolveConfirm();
  await flushMicrotasks();
  assert.deepEqual(actionCalls, [null]);
});
