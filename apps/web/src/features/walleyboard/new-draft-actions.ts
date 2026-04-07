import type {
  Project,
  RepositoryConfig,
} from "../../../../../packages/contracts/src/index.js";

type PersistNewDraftAction = "confirm" | "questions" | "refine" | "save";

export function createNewDraftActionHandlers(input: {
  draftEditorAcceptanceCriteriaLines: string[];
  draftEditorDescription: string;
  draftEditorProject: Project | null;
  draftEditorRepository: RepositoryConfig | null;
  draftEditorTicketType: string | null;
  draftEditorTitle: string;
  onConfirmDraft: (input: {
    acceptanceCriteria: string[];
    description: string;
    draftId: string;
    project: Project;
    repository: RepositoryConfig;
    ticketType: string | null;
    title: string;
  }) => Promise<void>;
  onQuestionDraft: (draftId: string) => Promise<void>;
  onRefineDraft: (draftId: string) => Promise<void>;
  persistNewDraftFromEditor: (
    action: PersistNewDraftAction,
  ) => Promise<string | null>;
  setPendingNewDraftAction: (value: PersistNewDraftAction | null) => void;
}) {
  const runPersistedNewDraftAction = (
    action: Exclude<PersistNewDraftAction, "save">,
    onDraftCreated: (draftId: string) => Promise<void>,
  ): void => {
    void (async () => {
      const draftId = await input.persistNewDraftFromEditor(action);
      if (!draftId) {
        return;
      }

      try {
        await onDraftCreated(draftId);
      } catch {
        // error is surfaced by react-query's mutation state
      } finally {
        input.setPendingNewDraftAction(null);
      }
    })();
  };

  const handleSaveNewDraft = (): void => {
    void input.persistNewDraftFromEditor("save");
  };

  const handleRefineNewDraft = (): void => {
    runPersistedNewDraftAction("refine", input.onRefineDraft);
  };

  const handleQuestionNewDraft = (): void => {
    runPersistedNewDraftAction("questions", input.onQuestionDraft);
  };

  const handleConfirmNewDraft = (): void => {
    if (!input.draftEditorProject || !input.draftEditorRepository) {
      return;
    }

    runPersistedNewDraftAction("confirm", (draftId) =>
      input.onConfirmDraft({
        acceptanceCriteria: input.draftEditorAcceptanceCriteriaLines,
        description: input.draftEditorDescription,
        draftId,
        project: input.draftEditorProject as Project,
        repository: input.draftEditorRepository as RepositoryConfig,
        ticketType: input.draftEditorTicketType,
        title: input.draftEditorTitle,
      }),
    );
  };

  return {
    handleConfirmNewDraft,
    handleQuestionNewDraft,
    handleRefineNewDraft,
    handleSaveNewDraft,
  };
}
