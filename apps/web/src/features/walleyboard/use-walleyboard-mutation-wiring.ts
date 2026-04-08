import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

import type { PendingDraftEditorSync } from "../../lib/draft-editor-sync.js";
import type { ArchiveActionFeedback, InspectorState } from "./shared-types.js";
import { useWalleyBoardMutations } from "./use-walleyboard-mutations.js";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export function useWalleyBoardMutationWiring(input: {
  pendingDraftEditorSync: PendingDraftEditorSync | null;
  queryClient: QueryClient;
  selectedDraftId: string | null;
  selectedProjectId: string | null;
  selectedSessionId: string | null;
  selectProject: (projectId: string | null) => void;
  setArchiveActionFeedback: StateSetter<ArchiveActionFeedback | null>;
  setDefaultBranch: StateSetter<string>;
  setInspectorState: StateSetter<InspectorState>;
  setPendingDraftEditorSync: StateSetter<PendingDraftEditorSync | null>;
  setPlanFeedbackBody: StateSetter<string>;
  setProjectColor: StateSetter<string>;
  setProjectDeleteConfirmText: StateSetter<string>;
  setProjectModalOpen: StateSetter<boolean>;
  setProjectName: StateSetter<string>;
  setProjectOptionsFormError: StateSetter<string | null>;
  setProjectOptionsProjectId: StateSetter<string | null>;
  setProjectOptionsRepositoryTargetBranches: StateSetter<
    Record<string, string>
  >;
  setRepositoryPath: StateSetter<string>;
  setRequestedChangesBody: StateSetter<string>;
  setResumeReason: StateSetter<string>;
  setTerminalCommand: StateSetter<string>;
  setValidationCommandsText: StateSetter<string>;
  tickets: TicketFrontmatter[];
}) {
  return useWalleyBoardMutations(input);
}
