import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  InboxAlertPayload,
  Project,
  RepositoryConfig,
  ReviewReport,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

import { EventHub, makeProtocolEvent } from "./event-hub.js";
import { InboxAlertCoordinator } from "./inbox-alert-coordinator.js";
import { SqliteStore } from "./sqlite-store.js";

type AlertTestHarness = {
  alerts: InboxAlertPayload[];
  coordinator: InboxAlertCoordinator;
  eventHub: EventHub;
  store: SqliteStore;
  tempDir: string;
  cleanup: () => void;
};

function createAlertTestHarness(): AlertTestHarness {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-inbox-alert-"));
  const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
  const eventHub = new EventHub();
  const coordinator = new InboxAlertCoordinator({ eventHub, store });
  const alerts: InboxAlertPayload[] = [];
  const unsubscribe = eventHub.subscribe((event) => {
    if (event.event_type === "inbox.alert") {
      alerts.push(event.payload as InboxAlertPayload);
    }
  });

  return {
    alerts,
    coordinator,
    eventHub,
    store,
    tempDir,
    cleanup: () => {
      unsubscribe();
      coordinator.stop();
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function createProjectFixture(
  store: SqliteStore,
  tempDir: string,
  overrides: {
    automaticAgentReview?: boolean;
  } = {},
): {
  project: Project;
  repository: RepositoryConfig;
} {
  const created = store.createProject({
    name: "Inbox Alert Project",
    repository: {
      name: "repo",
      path: join(tempDir, "repo"),
    },
  });

  if (overrides.automaticAgentReview === true) {
    const updatedProject = store.updateProject(created.project.id, {
      automatic_agent_review: true,
    });

    return {
      project: updatedProject,
      repository: created.repository,
    };
  }

  return created;
}

function createDraftFixture(
  store: SqliteStore,
  projectId: string,
  overrides: Partial<{
    title: string;
    description: string;
    wizardStatus: "editing" | "awaiting_confirmation" | "ready_to_create";
  }> = {},
) {
  const draft = store.createDraft({
    project_id: projectId,
    title: overrides.title ?? "Inbox alert draft",
    description: overrides.description ?? "Draft description",
    proposed_acceptance_criteria: ["Keep the draft actionable."],
  });

  if (overrides.wizardStatus) {
    return store.updateDraft(draft.id, {
      wizard_status: overrides.wizardStatus,
    });
  }

  return draft;
}

function startTicketFixture(input: {
  store: SqliteStore;
  tempDir: string;
  ticketId: number;
}): TicketFrontmatter {
  const started = input.store.startTicket(input.ticketId, false, {
    logs: [],
    workingBranch: `ticket-${input.ticketId}`,
    worktreePath: join(input.tempDir, "worktrees", `ticket-${input.ticketId}`),
  });

  return started.ticket;
}

function runInBatch(
  coordinator: InboxAlertCoordinator,
  callback: () => void,
): void {
  coordinator.beginBatch();
  try {
    callback();
  } finally {
    coordinator.endBatch();
  }
}

test("existing actionable items stay silent after the baseline is seeded", () => {
  const harness = createAlertTestHarness();

  try {
    const { project } = createProjectFixture(harness.store, harness.tempDir);
    const draft = createDraftFixture(harness.store, project.id, {
      wizardStatus: "awaiting_confirmation",
    });

    harness.coordinator.seedBaseline();
    harness.coordinator.start();
    harness.coordinator.evaluateNow();

    assert.equal(harness.alerts.length, 0);

    const updatedDraft = harness.store.updateDraft(draft.id, {
      description_draft: "Still waiting for human review.",
    });
    harness.eventHub.publish(
      makeProtocolEvent("draft.updated", "draft", draft.id, {
        draft: updatedDraft,
      }),
    );
    harness.coordinator.evaluateNow();

    assert.equal(harness.alerts.length, 0);
  } finally {
    harness.cleanup();
  }
});

test("draft notifications fire when a draft becomes ready for confirmation", () => {
  const harness = createAlertTestHarness();

  try {
    const { project } = createProjectFixture(harness.store, harness.tempDir);
    const draft = createDraftFixture(harness.store, project.id);

    harness.coordinator.seedBaseline();
    harness.coordinator.start();

    runInBatch(harness.coordinator, () => {
      const updatedDraft = harness.store.updateDraft(draft.id, {
        wizard_status: "awaiting_confirmation",
      });
      harness.eventHub.publish(
        makeProtocolEvent("draft.updated", "draft", draft.id, {
          draft: updatedDraft,
        }),
      );
    });

    assert.equal(harness.alerts.length, 1);
    assert.deepEqual(harness.alerts[0]?.notification_keys, [
      `draft-${draft.id}`,
    ]);
    assert.equal(harness.alerts[0]?.alerts[0]?.kind, "draft");
  } finally {
    harness.cleanup();
  }
});

test("review alerts wait for the handoff to settle and survive relaunch churn", () => {
  const harness = createAlertTestHarness();

  try {
    const { project, repository } = createProjectFixture(
      harness.store,
      harness.tempDir,
      {
        automaticAgentReview: true,
      },
    );
    const draft = createDraftFixture(harness.store, project.id);
    const readyTicket = harness.store.confirmDraft(draft.id, {
      title: draft.title_draft,
      description: draft.description_draft,
      repo_id: repository.id,
      ticket_type: "feature",
      acceptance_criteria: draft.proposed_acceptance_criteria,
      target_branch: "main",
    });
    harness.coordinator.seedBaseline();
    harness.coordinator.start();

    const startedTicket = startTicketFixture({
      store: harness.store,
      tempDir: harness.tempDir,
      ticketId: readyTicket.id,
    });
    const sessionId = startedTicket.session_id;
    if (!sessionId) {
      throw new Error("Expected the started ticket to include a session id");
    }

    runInBatch(harness.coordinator, () => {
      const runningSession = harness.store.updateSessionStatus(
        sessionId,
        "running",
        "Implementation is still running.",
      );
      if (!runningSession) {
        throw new Error("Expected the session to exist");
      }
      harness.eventHub.publish(
        makeProtocolEvent("session.updated", "session", runningSession.id, {
          agent_controls_worktree: true,
          session: runningSession,
        }),
      );

      const completedSession = harness.store.updateSessionStatus(
        runningSession.id,
        "completed",
        "Implementation completed.",
      );
      if (!completedSession) {
        throw new Error("Expected the completed session to exist");
      }
      harness.eventHub.publish(
        makeProtocolEvent("session.updated", "session", completedSession.id, {
          agent_controls_worktree: false,
          session: completedSession,
        }),
      );

      const reviewPackage = harness.store.createReviewPackage({
        ticket_id: readyTicket.id,
        session_id: completedSession.id,
        diff_ref: "/tmp/review.diff",
        commit_refs: ["abc123"],
        change_summary: "Ready for review.",
        validation_results: [],
        remaining_risks: [],
      });
      harness.eventHub.publish(
        makeProtocolEvent(
          "review_package.generated",
          "review_package",
          reviewPackage.id,
          {
            review_package: reviewPackage,
          },
        ),
      );

      const runningReviewRun = harness.store.createReviewRun({
        ticket_id: readyTicket.id,
        review_package_id: reviewPackage.id,
        implementation_session_id: completedSession.id,
        trigger_source: "automatic",
      });
      harness.eventHub.publish(
        makeProtocolEvent(
          "review_run.updated",
          "review_run",
          runningReviewRun.id,
          {
            review_run: runningReviewRun,
          },
        ),
      );

      const reviewTicket = harness.store.updateTicketStatus(
        readyTicket.id,
        "review",
      );
      if (!reviewTicket) {
        throw new Error("Expected the ticket to exist");
      }
      harness.eventHub.publish(
        makeProtocolEvent("ticket.updated", "ticket", String(reviewTicket.id), {
          ticket: reviewTicket,
        }),
      );

      const relaunchTicket = harness.store.updateTicketStatus(
        readyTicket.id,
        "in_progress",
      );
      if (!relaunchTicket) {
        throw new Error("Expected the ticket relaunch state to exist");
      }
      harness.eventHub.publish(
        makeProtocolEvent(
          "ticket.updated",
          "ticket",
          String(relaunchTicket.id),
          {
            ticket: relaunchTicket,
          },
        ),
      );

      const settledReviewTicket = harness.store.updateTicketStatus(
        readyTicket.id,
        "review",
      );
      if (!settledReviewTicket) {
        throw new Error("Expected the ticket to return to review");
      }
      harness.eventHub.publish(
        makeProtocolEvent(
          "ticket.updated",
          "ticket",
          String(settledReviewTicket.id),
          {
            ticket: settledReviewTicket,
          },
        ),
      );
    });

    assert.equal(harness.alerts.length, 0);

    runInBatch(harness.coordinator, () => {
      const completedReviewReport: ReviewReport = {
        summary: "Everything looks good.",
        strengths: [],
        actionable_findings: [],
      };
      const completedReviewRun = harness.store.updateReviewRun(
        harness.store.getLatestReviewRun(readyTicket.id)?.id ?? "",
        {
          report: completedReviewReport,
          status: "completed",
        },
      );
      if (!completedReviewRun) {
        throw new Error("Expected the review run to exist");
      }
      harness.eventHub.publish(
        makeProtocolEvent(
          "review_run.updated",
          "review_run",
          completedReviewRun.id,
          {
            review_run: completedReviewRun,
          },
        ),
      );
    });

    assert.equal(harness.alerts.length, 1);
    assert.equal(harness.alerts[0]?.alerts[0]?.kind, "review");
  } finally {
    harness.cleanup();
  }
});

test("session notifications only fire when the next step needs human input", () => {
  const harness = createAlertTestHarness();

  try {
    const { project, repository } = createProjectFixture(
      harness.store,
      harness.tempDir,
    );
    const draft = createDraftFixture(harness.store, project.id);
    const readyTicket = harness.store.confirmDraft(draft.id, {
      title: draft.title_draft,
      description: draft.description_draft,
      repo_id: repository.id,
      ticket_type: "feature",
      acceptance_criteria: draft.proposed_acceptance_criteria,
      target_branch: "main",
    });
    harness.coordinator.seedBaseline();
    harness.coordinator.start();

    const startedTicket = startTicketFixture({
      store: harness.store,
      tempDir: harness.tempDir,
      ticketId: readyTicket.id,
    });
    const sessionId = startedTicket.session_id;
    if (!sessionId) {
      throw new Error("Expected the started ticket to include a session id");
    }

    runInBatch(harness.coordinator, () => {
      const runningSession = harness.store.updateSessionStatus(
        sessionId,
        "running",
        "Implementation is still running.",
      );
      if (!runningSession) {
        throw new Error("Expected the running session to exist");
      }
      harness.eventHub.publish(
        makeProtocolEvent("session.updated", "session", runningSession.id, {
          agent_controls_worktree: true,
          session: runningSession,
        }),
      );
    });

    assert.equal(harness.alerts.length, 0);

    runInBatch(harness.coordinator, () => {
      const pausedSession = harness.store.updateSessionStatus(
        sessionId,
        "paused_user_control",
        "Human input is needed.",
      );
      if (!pausedSession) {
        throw new Error("Expected the paused session to exist");
      }
      harness.eventHub.publish(
        makeProtocolEvent("session.updated", "session", pausedSession.id, {
          agent_controls_worktree: false,
          session: pausedSession,
        }),
      );
    });

    assert.equal(harness.alerts.length, 1);
    assert.equal(harness.alerts[0]?.alerts[0]?.kind, "session");
  } finally {
    harness.cleanup();
  }
});
