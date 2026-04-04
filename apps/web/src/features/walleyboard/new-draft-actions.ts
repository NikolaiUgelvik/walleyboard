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
  }) => void;
  onQuestionDraft: (draftId: string) => void;
  onRefineDraft: (draftId: string) => void;
  persistNewDraftFromEditor: (
    action: PersistNewDraftAction,
  ) => Promise<string | null>;
}) {
  const runPersistedNewDraftAction = (
    action: Exclude<PersistNewDraftAction, "save">,
    onDraftCreated: (draftId: string) => void,
  ): void => {
    void (async () => {
      const draftId = await input.persistNewDraftFromEditor(action);
      if (!draftId) {
        return;
      }

      onDraftCreated(draftId);
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

    runPersistedNewDraftAction("confirm", (draftId) => {
      input.onConfirmDraft({
        acceptanceCriteria: input.draftEditorAcceptanceCriteriaLines,
        description: input.draftEditorDescription,
        draftId,
        project: input.draftEditorProject as Project,
        repository: input.draftEditorRepository as RepositoryConfig,
        ticketType: input.draftEditorTicketType,
        title: input.draftEditorTitle,
      });
    });
  };

  return {
    handleConfirmNewDraft,
    handleQuestionNewDraft,
    handleRefineNewDraft,
    handleSaveNewDraft,
  };
}
