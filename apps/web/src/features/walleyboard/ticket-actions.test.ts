import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { DraftTicketState } from "../../../../../packages/contracts/src/index.js";
import { createTicketActions } from "./ticket-actions.js";
import type { WalleyBoardMutations } from "./use-walleyboard-mutations.js";

function createDraft(id: string, criteria: string[] = []): DraftTicketState {
  return {
    id,
    project_id: "project-1",
    artifact_scope_id: `${id}-artifacts`,
    title_draft: `Draft ${id}`,
    description_draft: "body",
    proposed_acceptance_criteria: criteria,
    wizard_status: "editing",
    split_proposal_summary: null,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
    proposed_ticket_type: "feature",
    proposed_repo_id: null,
    confirmed_repo_id: null,
  };
}

function createMutationStub() {
  const calls: unknown[] = [];
  return {
    mutate: (arg: unknown) => {
      calls.push(arg);
    },
    calls,
  };
}

function createMutations(
  refineDraftStub: ReturnType<typeof createMutationStub>,
) {
  return {
    refineDraftMutation: refineDraftStub,
    archiveDoneTicketsMutation: { mutate: () => undefined },
    archiveTicketMutation: { mutate: () => undefined },
    deleteTicketMutation: { mutate: () => undefined },
    editReadyTicketMutation: { mutate: () => undefined },
    restartTicketMutation: { mutate: () => undefined },
  } as unknown as WalleyBoardMutations;
}

describe("createTicketActions", () => {
  describe("unrefinedDrafts", () => {
    test("includes drafts with empty proposed_acceptance_criteria", () => {
      const unrefined = createDraft("d1", []);
      const refined = createDraft("d2", ["criterion"]);
      const stub = createMutationStub();

      const { unrefinedDrafts } = createTicketActions({
        isDraftRefinementActive: () => false,
        mutations: createMutations(stub),
        selectedProjectId: "project-1",
        visibleDrafts: [unrefined, refined],
      });

      assert.deepStrictEqual(
        unrefinedDrafts.map((d) => d.id),
        ["d1"],
      );
    });

    test("excludes drafts that are currently being refined", () => {
      const draft1 = createDraft("d1", []);
      const draft2 = createDraft("d2", []);
      const stub = createMutationStub();

      const { unrefinedDrafts } = createTicketActions({
        isDraftRefinementActive: (id) => id === "d1",
        mutations: createMutations(stub),
        selectedProjectId: "project-1",
        visibleDrafts: [draft1, draft2],
      });

      assert.deepStrictEqual(
        unrefinedDrafts.map((d) => d.id),
        ["d2"],
      );
    });

    test("returns empty when all drafts are refined or refining", () => {
      const refined = createDraft("d1", ["criterion"]);
      const refining = createDraft("d2", []);
      const stub = createMutationStub();

      const { unrefinedDrafts } = createTicketActions({
        isDraftRefinementActive: (id) => id === "d2",
        mutations: createMutations(stub),
        selectedProjectId: "project-1",
        visibleDrafts: [refined, refining],
      });

      assert.deepStrictEqual(unrefinedDrafts, []);
    });
  });

  describe("refineAllUnrefinedDrafts", () => {
    test("calls refineDraftMutation.mutate for each unrefined draft", () => {
      const draft1 = createDraft("d1", []);
      const draft2 = createDraft("d2", []);
      const refined = createDraft("d3", ["criterion"]);
      const stub = createMutationStub();

      const { refineAllUnrefinedDrafts } = createTicketActions({
        isDraftRefinementActive: () => false,
        mutations: createMutations(stub),
        selectedProjectId: "project-1",
        visibleDrafts: [draft1, draft2, refined],
      });

      refineAllUnrefinedDrafts();

      assert.deepStrictEqual(stub.calls, ["d1", "d2"]);
    });

    test("is a no-op when there are no unrefined drafts", () => {
      const refined = createDraft("d1", ["criterion"]);
      const stub = createMutationStub();

      const { refineAllUnrefinedDrafts } = createTicketActions({
        isDraftRefinementActive: () => false,
        mutations: createMutations(stub),
        selectedProjectId: "project-1",
        visibleDrafts: [refined],
      });

      refineAllUnrefinedDrafts();

      assert.deepStrictEqual(stub.calls, []);
    });
  });
});
