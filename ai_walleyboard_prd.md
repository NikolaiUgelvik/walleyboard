# PRD: AI WalleyBoard Application

Current-state implementation details live in `README.md` and `docs/implementation-starter-pack.md`. This PRD describes the intended product direction, with Section 11 capturing the stricter MVP slice. Where the initial MVP cut and the current codebase differ, the current-state docs describe what ships today.

## 1. Overview
Build a local-first single-page application for orchestrating AI-assisted software work across multiple repositories, agent CLI sessions, and git worktrees. The application should provide a Kanban-style workflow for drafting, refining, planning, executing, reviewing, and completing engineering tickets from one interface.

The product is a power-user tool for engineers who want to manage multiple AI-assisted tasks in parallel without losing visibility into agent progress, git state, or pull request status.

## 2. Problem Statement
Engineering teams working across multiple repositories and worktrees need a centralized way to:
- Track work items visually
- Refine tickets with AI assistance before execution starts
- Launch and monitor agent CLI sessions tied to specific tickets
- Control whether execution starts directly or begins in model planning mode
- Understand what the active agent is doing through interpreted progress updates and open a worktree terminal when direct CLI work is needed

Today this workflow is fragmented across issue trackers, local notes, terminals, worktrees, and ad hoc scripts. That fragmentation makes it difficult to manage parallel AI-assisted execution safely and predictably.

## 3. Goals
- Provide a single-page application UI built with Mantine
- Use a Kanban board as the primary work management interface
- Let users create or refine tickets with AI help before execution begins
- Let users move tickets into active work with explicit approval
- Support two execution start modes:
  - Start working immediately
  - Start with the model's planning flag enabled
- Present interpreted execution progress and required user actions instead of making raw CLI transcripts the primary monitoring surface
- Manage multiple tickets and associated CLI sessions across many repos and worktrees from one interface

## 4. Non-Goals
- Replacing source control platforms or full issue trackers
- Supporting multi-user collaborative editing or shared real-time orchestration in v1
- Running purely autonomous execution with no user oversight
- Building a custom planning engine separate from the model's built-in planning mode

## 5. Target Users
### Primary Users
- Engineers managing multiple repositories and worktrees
- Technical leads coordinating parallel AI-assisted implementation work
- Power users running multiple agent CLI sessions concurrently

## 6. Product Model

### 6.1 Core Entities
- Project: a top-level workspace containing one board and one or more repositories
- Repository: a git repository attached to a project, with its own target branch configuration and optional lifecycle hooks
- Ticket: a unit of work scoped to exactly one repository
- Refinement session: a temporary AI-assisted drafting session used during ticket creation or refinement
- Execution session: the single durable agent CLI session that owns implementation for a ticket
- Worktree: the isolated filesystem workspace used by a ticket's execution session
- Pull request: an optional GitHub review object linked to a ticket

### 6.2 Board Workflow
The active board surface consists of the following columns:
- Draft: persisted draft records that are still being authored or refined and are not executable yet
- Ready: tickets that are refined enough to execute but are not currently active
- In Progress: tickets that are active, queued, or currently being worked on by the selected agent runtime
- Review: tickets under human review or linked to an open pull request
- Done: completed tickets

Archived done tickets are managed outside the active board and can be restored later.

State transitions:
- Promoting a `Draft` into `Ready` requires explicit confirmation of repository, ticket type, acceptance criteria, and target branch.
- Moving a ticket into `In Progress` requires explicit user approval.
- Moving a ticket into `In Progress` creates or resumes the ticket's execution session.
- If the concurrency limit has been reached, the ticket still moves to `In Progress` but its execution session enters a queued status until a slot opens.
- Moving a ticket into `Review` indicates code is ready for validation, PR creation, PR review, or merge.
- Requested changes move a ticket from `Review` back to `In Progress`.
- Moving a ticket into `Done` marks completion and finalizes logs, metadata, and cleanup eligibility.

### 6.3 Project Model
- The system must support multiple projects.
- Each project contains:
  - Project name
  - One Kanban board
  - One or more repositories
  - An optional project-level default target branch
  - Per-repository target branch configuration
  - Per-repository lifecycle hooks
- Tickets belong to a single project and exactly one repository inside that project.

#### Target Branch Behavior
- Every ticket must execute on its own generated working branch.
- A repository's configured target branch is the merge destination, not the execution branch.
- Repository-level target branch configuration overrides the project default target branch.
- If a configured target branch is expressed as a remote-tracking name such as `origin/main`, the system should normalize it to the local branch name `main` while still performing fetch, pull, and push operations as required.

### 6.4 Ticket Model
- A ticket must minimally contain:
  - Title
  - Description
  - Repository
  - Project
  - Ticket ID
- A ticket may begin as only a title and description draft.
- Before execution starts, the ticket refinement flow must expand that draft into an execution-ready ticket with confirmed repository scope and acceptance criteria.
- Tickets must be stored as SQLite-backed application records rather than standalone Markdown files on disk.
- Human-authored Markdown must be preserved literally in structured ticket fields such as title, description, and acceptance criteria.
- Machine-readable orchestration fields must live alongside those Markdown-bearing fields in the same persisted ticket record.
- Draft titles, descriptions, and acceptance criteria should preserve Markdown literally from the first draft through ready-ticket creation.
- Drafts and ready tickets may reference walleyboard-managed local image artifacts using Markdown image syntax.
- Each draft and ticket must carry a stable `artifact_scope_id` so pasted screenshot references stay valid across save, reload, refine, revert, and confirm actions.
- Ticket IDs must be numeric, stable after creation, and monotonic within the local store.
- Each ticket must map to exactly one repository.

Required persisted ticket fields:
- `id`
- `title`
- `description`
- `project`
- `repo`
- `artifact_scope_id`
- `status`
- `ticket_type`
- `acceptance_criteria`
- `working_branch`
- `target_branch`
- `linked_pr`
- `session_id`
- `created_at`
- `updated_at`

Storage constraints:
- The system must not materialize per-ticket Markdown files under the walleyboard home directory.
- The system must not require generated section headings such as `Context`, `Task`, or `Notes` inside persisted ticket content.
- Rendering-specific grouping may be derived at read time without changing the stored Markdown fields.

#### Epic Handling
- During ticket creation or refinement, the system must allow an AI-assisted drafting flow.
- The AI should:
  - Detect if the requested work is too large
  - Detect if the requested work spans multiple repositories
  - Propose splitting the work into smaller tickets
- Each resulting ticket must map to exactly one repository.
- If repository inference is uncertain, the system must ask the user to confirm.

### 6.5 Session Model
- Each ticket has exactly one primary execution session.
- The execution session is the durable agent CLI session associated with implementation for that ticket.
- The ticket creation drawer may use a separate temporary refinement session.
- A refinement session is not the same object as the primary execution session.
- Execution sessions must be resumable across application restarts.
- In the current MVP, resumability means preserving the logical session, worktree, and branch so the user can resume from `interrupted`; automatic live PTY reattachment remains deferred.
- Full raw logs of execution sessions must be persisted.
- Structured events must also be persisted.

Suggested execution session statuses:
- `queued`
- `running`
- `paused_checkpoint`
- `paused_user_control`
- `awaiting_input`
- `interrupted`
- `failed`
- `completed`

#### Execution Session Resume Semantics
- In v1, resumable does not require the original CLI process to survive indefinitely.
- The system should treat an execution session as a durable logical unit that may contain one or more process attempts over time.
- The target behavior on backend startup or reconnect is to first try to reattach to an existing PTY-backed Codex process if it is still alive.
- If the original process is no longer alive or cannot be reattached safely, the session should move to `interrupted`.
- From `interrupted`, the user may explicitly resume the session.
- Resuming an interrupted session should launch a new Codex process in the same worktree and branch using persisted context that includes:
  - The current ticket contents
  - The current git state
  - The latest relevant session summary or transcript excerpt
  - Any requested-changes note
  - Any failure summary or interruption reason
- Session history should preserve each process attempt as part of one logical execution session.

### 6.6 Planning Terminology
To avoid ambiguity, the product should distinguish between two separate concepts:
- AI-assisted ticket refinement: an optional drafting feature used while creating or refining a ticket
- Execution planning flag: a session launch option that starts the model in planning mode before implementation

Neither concept is a separate board column or board state. The non-active work columns are `Draft` and `Ready`.

### 6.7 Ticket Lifecycle Summary
The intended v1 happy path is:
1. The user selects a project.
2. The user creates a new ticket draft with a title and description.
3. The user runs the AI-assisted ticket refinement flow.
4. The refinement flow improves wording, checks feasibility, identifies missing information, confirms the repository, and produces an execution-ready ticket.
5. The ticket is saved in `Ready`.
6. The user explicitly approves moving the ticket to `In Progress`.
7. The system creates or restores the worktree and working branch, then launches or resumes the execution session.
8. The agent implements the change, creates commits on the working branch, and moves the ticket to `Review` only after producing a review package.
9. In `Review`, the user inspects the diff, commits, summaries, and test results, then either requests changes, creates a PR, or merges directly.
10. If the user requests changes, the same ticket, worktree, branch, and execution session return to `In Progress`.
11. If the user stops an in-progress ticket, the active attempt is interrupted, the ticket remains in `In Progress`, and the worktree and working branch are preserved for explicit resume.
12. If the user deletes a ticket, the system should stop any active execution first, remove walleyboard-managed local artifacts, remove the ticket from the board, and delete persisted walleyboard metadata.
13. If the user merges directly, the system merges into the target branch, marks the ticket `Done`, and cleans up the worktree and local working branch.
14. If the user creates a PR, the ticket remains in `Review` until the PR is merged, after which the ticket becomes `Done` and cleanup runs.

## 7. Functional Requirements

### 7.1 Ticket Creation and Refinement
- Ticket creation should occur in a side drawer so the UI remains board-centric.
- The user starts by selecting a project and entering:
  - A title
  - A description
- The title, description, and acceptance criteria editors must accept Markdown authoring and show a preview using the same Markdown rendering rules used elsewhere in the board.
- Pasting an image from the clipboard into the draft description must store the image under an walleyboard-managed artifact path scoped to the draft/ticket and insert a Markdown image reference at the current cursor position.
- Non-image clipboard contents must retain normal text paste behavior.
- The drawer may spawn a temporary refinement session to help the user:
  - Refine grammar and clarity
  - Improve task wording
  - Validate completeness
  - Check basic feasibility
  - Ask follow-up questions when required information is missing
  - Propose better alternatives when the requested approach is not feasible or is a poor fit
  - Infer the correct repository
  - Confirm the repository with the user
  - Propose a ticket type such as `feature`, `bugfix`, or `chore`
  - Detect epic-sized work
  - Propose repo-scoped ticket splits when needed
- The refinement experience should behave like a guided wizard rather than a single opaque rewrite.
- The wizard should present concrete recommendations step by step and allow the user to:
  - Accept or reject wording improvements
  - Answer missing-information questions
  - Choose among feasibility alternatives
  - Confirm repository assignment
  - Confirm or edit acceptance criteria
  - Accept proposed ticket splits
- The goal is to ensure tickets are execution-ready before they enter `Ready` or `In Progress`.

#### Draft Persistence and Ticket Split Semantics
- A new ticket should begin as a persisted `draft` record before it becomes `Ready`.
- Draft records may appear in a dedicated `Draft` board column, but they must remain non-executable until they are explicitly confirmed as execution-ready.
- If the user closes the drawer or the app restarts, draft progress must be recoverable.
- Wizard progress should persist:
  - The latest draft title and description
  - The draft's stable `artifact_scope_id` and any pasted screenshot references stored under that scope
  - Proposed wording improvements
  - Missing-information prompts and answers
  - Repository suggestions and confirmations
  - Feasibility alternatives
  - Proposed acceptance criteria
  - Proposed split plans
- Proposed ticket splits should remain provisional until the user explicitly confirms them.
- If the user accepts a split, the system should atomically create one draft or ready ticket per approved split item.
- The original unsplit draft should not remain as an executable multi-repository ticket.

#### Ticket Readiness Requirements
A ticket must not start execution until all of the following are true:
- The title and description are in an acceptable final form
- The repository is confirmed
- Acceptance criteria are present
- Feasibility concerns are either resolved or replaced with an approved alternative
- The work is scoped to exactly one repository
- The target branch is known
- Any required ticket split has been accepted or explicitly declined by the user

### 7.2 Start of Execution
When a ticket is explicitly approved and moved to `In Progress`, the system should automatically:
- Create or restore the worktree
- Create or restore the working branch
- Launch or resume the execution session through the backend-managed execution runtime

Execution start options:
- Start immediately
- Start with the model's planning flag enabled

Before execution begins, the user should see an approval summary that includes:
- Ticket title
- Repository
- Target branch
- Generated working branch
- Whether the planning flag is enabled
- Whether the ticket will start immediately or remain queued because of concurrency limits

#### Stop Ticket Action
- The user should be able to stop a ticket while it is `in_progress`.
- Stop should be available only when the ticket has an active or resumable execution session in a non-terminal state such as `queued`, `running`, `paused_checkpoint`, `paused_user_control`, or `awaiting_input`.
- Stopping a ticket should:
  - Interrupt the current process attempt
  - Move the execution session to `interrupted`
  - Keep the ticket itself in `in_progress`
  - Preserve the existing worktree and working branch
  - Record the stop reason in logs and structured events when provided
- After stop completes, the user should be able to resume the same logical session from the preserved worktree and branch.

#### Delete Ticket Action
- The user should be able to delete any board-visible ticket.
- Deleting a ticket is a destructive orchestration action, not a ticket-state transition.
- If the ticket has active execution, the system must stop that execution before cleanup proceeds.
- Deleting a ticket should remove:
  - The persisted ticket record
  - Associated execution-session metadata, attempts, logs, requested-change notes, and review-package metadata
  - WalleyBoard-owned local artifacts for the ticket, including the worktree, local working branch, stored review diff, validation logs, and persisted session summary files when present
- Deleting a ticket must not revert or rewrite code that has already been merged into the target branch.
- If some cleanup step fails, the system should still remove the walleyboard record and surface cleanup warnings to the user.

### 7.3 Worktree and Branch Management
- Each ticket must execute in its own isolated worktree.
- Worktrees must live under an application-managed directory, for example `~/.walleyboard/worktrees/<project-slug>/<ticket-id>/`.
- Worktrees must persist until the ticket reaches `Done`.
- Worktrees must survive application restarts and machine restarts.
- Worktrees become eligible for cleanup only after the ticket is `Done`.

#### Branching
- Branch names must be generated automatically.
- Branch naming should be derived from:
  - Ticket type, such as `feature` or `bugfix`
  - Ticket ID
  - A slug derived from the title
- Example format: `feature/<ticket-id>-<slug>` or `bugfix/<ticket-id>-<slug>`

### 7.4 In Progress Execution Behavior
- While running, the Codex CLI should operate autonomously within the ticket worktree.
- The CLI should enter a waiting state and notify the user at checkpoints when:
  - User input is required
  - Ambiguity is encountered
  - Approval is needed
- The application must surface these waiting states clearly, notify the user immediately, and allow the user to respond or resume.
- The execution session must always run in the context of the ticket's repository and worktree.
- Before a ticket can move to `Review`, the execution session must have produced committed changes on the ticket's working branch unless the task is explicitly no-code.
- If the execution session is interrupted because the backend restarts or the PTY process is lost, the ticket should remain in `In Progress` while the session moves to `interrupted`.

### 7.5 Session Activity and Manual Terminal Access
- The default ticket or session view must present interpreted agent activity rather than a raw Codex terminal transcript.
- Ticket cards should expose compact action icons for diff, terminal, preview, and full interpreted activity.
- The inspector workspace area should collapse to a single high-signal activity summary row that opens the same interpreted activity stream.
- Diff, terminal, and preview actions should require a prepared worktree, while the activity action should remain available whenever session history still exists.
- The preview action should start the ticket dev server when needed, open the preview in a new browser tab, and switch to a stop control while that dev server remains active.
- The ticket-card terminal action should open a plain worktree shell without take-over or restore-agent controls on that surface, and it should remain unavailable only while a live agent process still owns the worktree.
- The primary monitoring surface should emphasize:
  - Current session status
  - The latest high-signal agent updates
  - Validation progress
  - Review readiness
  - Required user input or approval
- Full raw logs may still be persisted for debugging, but they must not be the default UI for following Codex progress.
- If the product exposes a terminal, it should be framed as a separate plain worktree terminal for user-initiated commands rather than the primary place to watch Codex work.

#### Manual Terminal Ownership
- A manual terminal, if present, must be clearly distinct from the interpreted Codex activity view.
- If the product later allows the user to take over the same live PTY used by the agent, ownership semantics must remain explicit.
- The system must never allow simultaneous user and agent writes to stdin.
- If a shared PTY handoff mode is introduced later, the execution session must pause and enter `paused_user_control` until the user explicitly returns control.

### 7.6 Review Stage and Git Operations
- The application must provide UI controls for:
  - Creating pull requests
  - Checking pull request status
  - Rebasing branches
  - Merging branches
- The `Review` column represents either:
  - Human review before merge
  - An active GitHub pull request
- If the agent determines that work is complete and ready either for local merge or PR creation, the ticket should move to `Review`.
- A ticket must not move to `Review` unless the system can present a review package containing:
  - A diff view
  - A list of commits on the working branch
  - An agent-generated summary of the changes
  - A summary of tests run
  - A summary of tests skipped
  - Remaining risks or follow-up notes
- If review results in requested changes, the ticket must move back to `In Progress`.
- Requesting changes should keep the same ticket, worktree, working branch, and execution session.
- A requested-changes note must be attached to the ticket and surfaced to the execution session when work resumes.

### 7.7 Merge, Pull Request, and Done Semantics
From `Review`, the user must be able to choose one of the following actions:
- Request changes
- Create a pull request
- Merge directly into the target branch

#### Direct Merge Path
If the user chooses direct merge:
- The system should refresh the target branch state before merging.
- The system should rebase the ticket's working branch onto the latest target branch before final merge.
- If the rebase fails because of conflicts, the ticket should return to `In Progress` with a merge-conflict note.
- If the rebase succeeds, the system should merge the rebased working branch into the target branch.
- The system should push the merged target branch when required.
- If the merge completes successfully, the ticket should move to `Done`.
- After a successful direct merge, the system should clean up the worktree and the local working branch by default.

#### Pull Request Path
If the user chooses to create a pull request:
- The system should create the PR using the ticket's working branch.
- The ticket should remain in `Review` while the PR is open.
- The ticket should expose the linked PR status and URL.
- Once the PR is merged, the ticket should move to `Done`.
- After PR merge, the system should clean up the worktree and local working branch by default.
- Remote branch deletion should default to enabled when applicable and safe.

#### Done State
A ticket is considered `Done` when either:
- Its changes are merged into the target branch for that repository
- Its associated pull request is merged

When a ticket becomes `Done`, the system should:
- Finalize logs and summaries
- Run default cleanup for the worktree and local working branch unless cleanup is explicitly deferred because of an error
- Preserve enough metadata to inspect the ticket's history later

### 7.8 Structured Event Log
- The system must maintain a structured event log in addition to full raw logs and transcripts.
- Structured events should include examples such as:
  - Worktree created
  - Worktree restored
  - Worktree removed
  - Sandbox started
  - Codex session started
  - Codex queued
  - Codex checkpoint requested
  - Codex input requested
  - Codex resumed
  - Commit created
  - Push performed
  - PR opened
  - PR merged
  - Ticket state changed
- The UI must provide a structured events tab.

### 7.9 Agent-Generated Summaries
- The agent should generate human-readable summaries at key milestones, including:
  - After ticket refinement: a refined ticket summary
  - After model planning mode: an implementation plan summary
  - When entering `Review`: a summary of changes, testing, and remaining risks
  - On failure: a failure summary

### 7.10 Validation and Review Gates
- Each repository may define a validation profile containing commands such as:
  - Setup
  - Lint
  - Test
  - Build
  - Custom verification commands
- Validation commands should be configured per repository rather than inferred at runtime.
- Each validation command must define:
  - Label
  - Command
  - Working directory
  - Timeout
  - Whether it is required for `Review`
- Before a ticket can move to `Review`, all required validation commands should run unless the user explicitly overrides them.
- If a required validation command fails, the default behavior should block the transition to `Review`.
- A user may explicitly override a failed required validation gate.
- Any override must be recorded in the ticket history and included in the review package.
- The review package must surface command-by-command validation results, including:
  - Pass or fail state
  - Start and end time
  - Exit code
  - Whether the command was skipped
  - Whether failure was overridden

### 7.11 Failure and Recovery Basics
- If an execution session fails, the ticket must remain recoverable.
- Failure must not delete the worktree or working branch.
- The ticket should surface:
  - The failure state
  - A failure summary
  - The most recent relevant logs
- After a failure, the user should be able to:
  - Resume the same execution session when possible
  - Open a separate manual project terminal if the product exposes one later
  - Keep the ticket in `In Progress` while resuming from the preserved worktree and branch

### 7.12 Concurrency Limits and Queueing
- Maximum concurrent active execution sessions should be configurable.
- A reasonable default should be 4 concurrent sessions.
- If the limit is exceeded, additional tickets may still be moved to `In Progress`, but their execution sessions must remain in `queued` status until a slot opens.
- The board and ticket details must clearly distinguish queued work from actively running work.

### 7.13 Card Contents
Each Kanban card should display:
- Title
- Repository
- Ticket ID
- Working branch
- PR status
- Session status
- Last updated time
- Blocked or waiting marker
- Inline status badge for failure or error conditions

### 7.14 Formal Ticket and Session State Machines
Ticket lifecycle state and execution session state must be modeled separately.

#### Ticket States
- `draft`: a ticket being created or refined and not yet execution-ready
- `ready`: execution-ready and waiting for explicit activation
- `in_progress`: actively running, queued, paused, interrupted, or failed execution associated with the ticket
- `review`: implementation is complete enough for human review or PR review
- `done`: the change has been merged and the ticket is complete

Allowed ticket transitions:
- `draft -> ready`
  - Actor: user
  - Guard: ticket readiness requirements pass
  - Side effects: persist final draft content and board-visible metadata
- `ready -> in_progress`
  - Actor: user
  - Guard: explicit approval granted
  - Side effects: create or restore worktree, ensure working branch exists, enqueue or launch session
- `in_progress -> review`
  - Actor: system or agent
  - Guard: committed changes exist or task is explicitly no-code, review package exists, required validation gates pass or are overridden
  - Side effects: freeze review package snapshot and stop autonomous execution
- `review -> in_progress`
  - Actor: user
  - Guard: requested-changes note or merge-conflict remediation required
  - Side effects: attach review feedback and resume the same logical session
- `review -> done`
  - Actor: system
  - Guard: direct merge succeeds or linked PR is observed as merged
  - Side effects: finalize logs, cleanup artifacts, persist completion metadata

Deletion semantics:
- User-driven deletion may remove a ticket entirely from any board-visible state instead of transitioning it to another ticket state.
- Deletion must first stop active execution when present, then remove walleyboard-managed metadata and local artifacts.
- Deletion of a `done` ticket must not modify already-merged target-branch code.

#### Execution Session States
- `queued`
- `running`
- `paused_checkpoint`
- `paused_user_control`
- `awaiting_input`
- `interrupted`
- `failed`
- `completed`

Allowed execution session transitions:
- `queued -> running`
  - Actor: scheduler
  - Guard: concurrency slot is available and prerequisites are satisfied
- `queued -> interrupted`
  - Actor: user or system
  - Guard: explicit stop requested or recovery converts a queued session into a non-running state
- `running -> paused_checkpoint`
  - Actor: agent
  - Guard: checkpoint requested for approval or clarification
- `running -> awaiting_input`
  - Actor: agent
  - Guard: explicit user answer is required
- `running -> paused_user_control`
  - Actor: user
  - Guard: user takes terminal control
- `running -> interrupted`
  - Actor: user or system
  - Guard: explicit stop requested, PTY process is lost, or backend restarts before clean completion
- `paused_checkpoint -> interrupted`
  - Actor: user
  - Guard: explicit stop requested
- `awaiting_input -> interrupted`
  - Actor: user
  - Guard: explicit stop requested
- `paused_user_control -> interrupted`
  - Actor: user
  - Guard: explicit stop requested
- `running -> failed`
  - Actor: system or agent
  - Guard: unrecoverable execution failure occurs
- `running -> completed`
  - Actor: system
  - Guard: implementation phase is complete and the ticket has transitioned to `Review` or `Done`
- `paused_checkpoint -> running`
  - Actor: user
  - Guard: checkpoint response is provided
- `awaiting_input -> running`
  - Actor: user
  - Guard: required input is provided
- `paused_user_control -> running`
  - Actor: user
  - Guard: agent control is explicitly restored
- `interrupted -> running`
  - Actor: user
  - Guard: explicit resume requested
  - Side effects: launch a new process attempt in the same logical session
- `failed -> running`
  - Actor: user
  - Guard: resume is allowed by failure policy
  - Side effects: launch a new process attempt in the same logical session

## 8. Architecture and Persistence

### 8.1 Product Scope
- The application is a single-user power tool.
- Execution occurs only on the local machine.
- The system is local-first.

### 8.2 Local Storage
- Application state must persist locally in a dedicated application directory such as `~/.walleyboard/`.
- Local state should include:
  - A local SQLite database file that stores projects, repositories, drafts, tickets, sessions, structured events, review packages, requested change notes, and session logs
  - Persisted diff artifacts, validation logs, agent summaries, and draft analysis outputs
  - Project and repository configuration stored inside the database
  - Walleyboard-managed image artifacts referenced from draft or ticket Markdown
  - Managed worktrees

Suggested layout:
- `~/.walleyboard/walleyboard.sqlite`
- `~/.walleyboard/ticket-artifacts/<project-slug>/<artifact-scope-id>/`
- `~/.walleyboard/review-packages/<project-slug>/`
- `~/.walleyboard/validation-logs/<project-slug>/ticket-<ticket-id>/`
- `~/.walleyboard/agent-summaries/<project-slug>/`
- `~/.walleyboard/draft-analyses/<project-slug>/`
- `~/.walleyboard/worktrees/<project-slug>/`

Storage rules:
- Tickets and drafts must not be mirrored into standalone Markdown files on disk.
- The SQLite database is the source of truth for ticket and draft content as well as orchestration metadata.

#### Backend Runtime Components
The local backend should be the single source of truth for ticket, session, and worktree state.

Recommended backend components:
- API server for user actions and CRUD operations
- Realtime transport for PTY data, logs, structured events, and state updates
- Ticket store backed by SQLite records that preserve Markdown fields without creating per-ticket files
- Session manager for lifecycle control and resume logic
- PTY manager for interactive Codex processes
- Scheduler for concurrency limits and queue release
- Worktree manager for create, restore, and cleanup operations
- Git service for branch, commit, diff, merge, and rebase operations
- GitHub reconciler for PR synchronization
- Hook runner for repository lifecycle commands
- Event bus for structured event emission and fan-out

Communication model:
- The frontend should issue command-style mutations to the backend.
- The backend should publish authoritative state changes and event streams back to the frontend.
- Long-running operations must be backend-owned rather than browser-owned.

#### Backend Transport Protocol
V1 should use:
- HTTP with JSON request and response bodies for reads and command-style mutations
- WebSocket for PTY output, raw logs, structured events, and authoritative state updates

Transport rules:
- The frontend must not assume optimistic success for long-running mutations.
- Mutations should return an immediate acknowledgment plus the IDs of affected resources when possible.
- Final success or failure of long-running work must be communicated by subsequent state updates and events from the backend.
- The backend must remain the only authority on ticket state, session state, queue state, and worktree state.

#### Resource Read Endpoints
The backend should expose read APIs for at least:
- `GET /projects`
- `GET /projects/:projectId`
- `GET /projects/:projectId/repositories`
- `GET /projects/:projectId/tickets`
- `GET /projects/:projectId/drafts`
- `GET /tickets/:ticketId`
- `GET /tickets/:ticketId/review-package`
- `GET /tickets/:ticketId/events`
- `GET /sessions/:sessionId`
- `GET /sessions/:sessionId/attempts`
- `GET /sessions/:sessionId/logs`

#### Command Endpoints
The backend should expose command-style mutation APIs for at least:
- `POST /projects`
  - Create a project and its initial repository configuration
- `POST /drafts`
  - Create a new `DraftTicketState`
- `POST /drafts/:draftId/refine`
  - Start or continue the refinement flow
- `POST /drafts/:draftId/confirm`
  - Apply accepted wizard decisions and attempt to create a `ready` ticket
- `POST /tickets/:ticketId/start`
  - Move a ready ticket into `in_progress`
- `POST /tickets/:ticketId/stop`
  - Interrupt an in-progress execution session while preserving the worktree and working branch for resume
- `POST /tickets/:ticketId/resume`
  - Resume a queued, interrupted, paused, or failed execution session when allowed
- `POST /tickets/:ticketId/delete`
  - Delete the ticket record and clean up walleyboard-owned local artifacts
- `POST /tickets/:ticketId/request-changes`
  - Move a review ticket back to `in_progress` with a `RequestedChangeNote`
- `POST /tickets/:ticketId/create-pr`
  - Create a PR from the ticket's working branch
- `POST /tickets/:ticketId/merge`
  - Attempt the direct merge flow
- `POST /tickets/:ticketId/reconcile`
  - Force an external reconciliation pass
- `POST /sessions/:sessionId/terminal/takeover`
  - Move the session into `paused_user_control`
- `POST /sessions/:sessionId/terminal/restore-agent`
  - Return terminal ownership to the agent
- `POST /sessions/:sessionId/checkpoint-response`
  - Submit a checkpoint or approval response
- `POST /sessions/:sessionId/input`
  - Submit required user input to an `awaiting_input` session

Command response shape:
- Every command response should include:
  - `accepted: boolean`
  - `command_id: string`
  - `issued_at: string`
  - `resource_refs: { project_id?: string, repo_id?: string, ticket_id?: number, session_id?: string, draft_id?: string }`
  - `message: string | null`
- A command response acknowledges receipt and validation only.
- A command response does not by itself guarantee final success of long-running work.

#### WebSocket Event Stream
The frontend should open one authenticated local WebSocket connection to receive backend-originated events.

Event envelope:
- `event_id: string`
- `event_type: string`
- `occurred_at: string`
- `entity_type: "ticket" | "session" | "attempt" | "draft" | "review_package" | "pull_request" | "worktree" | "git" | "system"`
- `entity_id: string`
- `payload: object`

Required event families:
- `ticket.updated`
- `ticket.deleted`
- `draft.updated`
- `draft.ready`
- `session.updated`
- `session.output`
- `session.checkpoint_requested`
- `session.input_requested`
- `session.summary_generated`
- `review_package.generated`
- `validation.updated`
- `pull_request.updated`
- `structured_event.created`
- `command.rejected`

#### PTY and Log Streaming Rules
- Interactive PTY output should be delivered over WebSocket as ordered chunks tied to `session_id` and `attempt_id`.
- The backend should assign a monotonic sequence number to PTY output messages per attempt.
- The frontend should treat PTY output as append-only stream data rather than reconstructing session state from output text.
- Structured state changes must always be delivered as separate state or event messages rather than inferred from PTY output.

#### State Snapshot Messages
The WebSocket stream should also carry authoritative state snapshots for resource updates.

Recommended snapshot event payloads:
- `ticket.updated`
  - Full current ticket summary for board and detail views
- `draft.updated`
  - Full current draft state for the refinement drawer
- `session.updated`
  - Full current execution session state including current attempt reference
- `pull_request.updated`
  - Full current `PullRequestRef`
- `review_package.generated`
  - Full current `ReviewPackage`

#### Command Failure Semantics
- If a command is invalid at submission time, the backend should reject it synchronously with `accepted: false`.
- If a command is accepted but later fails during execution, the backend should emit:
  - A `command.rejected` or domain-specific failure event
  - Updated resource state showing the failure outcome
- The frontend must render from final backend state rather than assuming mutation success because the initial command was accepted.

#### Codex Adapter Contract
V1 should use a Codex CLI adapter as the primary execution runtime.

Adapter scope:
- The walleyboard should treat Codex CLI as the execution engine for both:
  - AI-assisted ticket refinement
  - Autonomous ticket implementation
- The internal backend architecture should still keep a narrow adapter boundary so alternate runtimes can be introduced later without changing ticket, session, or review semantics.

Documented behavior alignment:
- The adapter must assume Codex CLI runs locally and can read, modify, and run code on the user's machine.
- The adapter must keep local execution under backend control rather than allowing the model to execute commands outside the walleyboard's runtime boundaries.
- The adapter must launch Codex with the intended execution mode, keep worktree and session control under backend ownership, capture logs and summaries, and enforce UI-level approvals around workflow actions.
- The adapter must not rely on undocumented internal Codex behavior when a conservative backend-controlled alternative exists.

Mode mapping:
- Ticket refinement should use an ask-style interaction pattern where the goal is analysis, clarification, and improved ticket quality rather than code modification.
- Ticket execution should use a code-style interaction pattern where the goal is to modify code, run validation commands, and prepare work for review.
- The ticket `planning_enabled` launch option should map to the documented planning-oriented behavior of the execution runtime rather than a custom orchestration planner.

Adapter launch contract:
- Every execution launch or resume must provide Codex with a context package containing at least:
  - Ticket title
  - Ticket description and acceptance criteria
  - Repository path
  - Worktree path
  - Working branch
  - Target branch
  - Whether planning is enabled
  - Validation profile summary
  - Any requested-changes note
  - Any latest failure or interruption summary
  - Autonomy policy summary
- Resumed attempts must include enough persisted context for Codex to continue work in the same logical session without relying on the previous PTY process still existing.

Autonomy policy:
- The Codex adapter should run as autonomously as possible within Codex execution policy and repository policy.
- The default policy should be:
  - Continue working without user interruption while the task is clear and allowed
  - Ask for input when clarification is required
  - Enter a waiting-for-user state and notify the user when the workflow requires an explicit decision
- Required explicit user decisions include at minimum:
  - Starting execution from `ready`
  - Accepting or declining ticket split proposals
  - Overriding failed required validation gates
  - Requesting direct merge
  - Creating a pull request if the product keeps that action user-initiated
  - Returning terminal ownership to the agent after manual takeover
- The adapter must not merge code, create a PR, or bypass a required validation gate without an explicit user action through the walleyboard UI.

Checkpoint and input contract:
- The backend must expose one unified session-control model even if Codex surfaces pauses in different ways across versions.
- The adapter should map Codex execution into the walleyboard states:
  - `paused_checkpoint`
  - `awaiting_input`
  - `paused_user_control`
  - `interrupted`
- If Codex explicitly requests clarification or approval, the adapter should emit:
  - `session.checkpoint_requested` for approval-style pauses
  - `session.input_requested` for freeform user input requests
- Emitting either `session.checkpoint_requested` or `session.input_requested` must also:
  - Persist the session in the corresponding waiting state
  - Trigger a user-visible notification in the walleyboard UI
- If Codex does not provide a strongly structured signal for a possible pause, the adapter should prefer conservative backend-controlled pauses rather than brittle text parsing when the transition would affect ticket state.

Review handoff contract:
- Codex may suggest that work is complete, but the backend should be responsible for deciding whether the ticket can actually transition to `Review`.
- The adapter may request review readiness, but the backend must verify:
  - Required commits exist on the working branch
  - Required validation commands have completed or been explicitly overridden
  - A review package can be generated
- Ticket state transitions must remain backend-owned even if Codex proposes them in natural language.

Adapter event contract:
- The adapter should emit structured internal events for at least:
  - `adapter.session_started`
  - `adapter.output_chunk`
  - `adapter.checkpoint_requested`
  - `adapter.input_requested`
  - `adapter.summary_available`
  - `adapter.process_exited`
  - `adapter.error`
- Backend domain services may translate those internal adapter events into the public WebSocket event stream.

Summary contract:
- The adapter should support summary generation for:
  - Ticket refinement output
  - Planning output
  - Review handoff
  - Failure or interruption recovery
- If Codex does not emit a structured summary directly, the backend may trigger a follow-up summarization step using the latest persisted context and transcript excerpts.

Safety and audit contract:
- The adapter must persist the full PTY transcript for each attempt.
- The adapter must record the exact launch parameters for each attempt except for redacted secrets.
- The adapter must preserve enough audit data to answer:
  - What prompt or context package was used
  - Which worktree and branch were targeted
  - Which validations were run
  - Why the session paused, failed, or resumed

Implementation guidance:
- V1 should be CLI-first, not API-first.
- The walleyboard should use Codex CLI as the primary documented execution path and avoid inventing a separate custom shell-agent loop unless a required Codex capability is unavailable through the CLI.
- If a future runtime uses the Responses API directly, it should remain compatible with the same ticket, session, and review contracts defined in this PRD.

### 8.3 Ticket Storage
- Tickets should remain human-readable and editable through the application while being persisted as SQLite records.
- Markdown-bearing fields such as title, description, and acceptance criteria must remain readable without lossy transformation.
- Machine fields needed for orchestration should live in explicit database columns or JSON fields on the same ticket record.
- PR links and related metadata should live on the ticket record rather than being duplicated into a separate ticket file format.

#### Core Persisted Models
The following persisted models should be treated as v1 contracts.

Type conventions:
- All timestamps should be stored as ISO 8601 UTC strings.
- All filesystem paths should be stored as absolute paths.
- All IDs except ticket numbers should be opaque string IDs generated by the application.

HookConfig:
- `command: string`
- `working_directory: string`
- `timeout_ms: number`
- `failure_policy: "block" | "warn" | "ignore"`
- `shell: boolean`

ValidationCommand:
- `id: string`
- `label: string`
- `command: string`
- `working_directory: string`
- `timeout_ms: number`
- `required_for_review: boolean`
- `shell: boolean`

ValidationResult:
- `command_id: string`
- `label: string`
- `status: "passed" | "failed" | "skipped"`
- `started_at: string`
- `ended_at: string`
- `exit_code: number | null`
- `failure_overridden: boolean`
- `summary: string | null`
- `log_ref: string | null`

PullRequestRef:
- `provider: "github"`
- `repo_owner: string`
- `repo_name: string`
- `number: number`
- `url: string`
- `head_branch: string`
- `base_branch: string`
- `state: "open" | "closed" | "merged" | "unknown"`

RequestedChangeNote:
- `id: string`
- `ticket_id: number`
- `review_package_id: string | null`
- `author_type: "user" | "system"`
- `body: string`
- `created_at: string`

DraftTicketState:
- `id: string`
- `project_id: string`
- `title_draft: string`
- `description_draft: string`
- `proposed_repo_id: string | null`
- `confirmed_repo_id: string | null`
- `proposed_ticket_type: "feature" | "bugfix" | "chore" | "research" | null`
- `proposed_acceptance_criteria: string[]`
- `wizard_status: "editing" | "awaiting_confirmation" | "ready_to_create"`
- `split_proposal_summary: string | null`
- `created_at: string`
- `updated_at: string`

Project:
- `id: string`
- `slug: string`
- `name: string`
- `default_target_branch: string | null`
- `max_concurrent_sessions: number`
- `created_at: string`
- `updated_at: string`

RepositoryConfig:
- `id: string`
- `project_id: string`
- `name: string`
- `path: string`
- `target_branch: string | null`
- `setup_hook: HookConfig | null`
- `cleanup_hook: HookConfig | null`
- `validation_profile: ValidationCommand[]`
- `extra_env_allowlist: string[]`
- `created_at: string`
- `updated_at: string`

Ticket record:
- `id: number`
- `project: string`
- `repo: string`
- `artifact_scope_id: string`
- `status: "draft" | "ready" | "in_progress" | "review" | "done"`
- `title: string`
- `description: string`
- `ticket_type: "feature" | "bugfix" | "chore" | "research"`
- `acceptance_criteria: string[]`
- `working_branch: string | null`
- `target_branch: string`
- `linked_pr: PullRequestRef | null`
- `session_id: string | null`
- `created_at: string`
- `updated_at: string`

ExecutionSession:
- `id: string`
- `ticket_id: number`
- `project_id: string`
- `repo_id: string`
- `status: "queued" | "running" | "paused_checkpoint" | "paused_user_control" | "awaiting_input" | "interrupted" | "failed" | "completed"`
- `planning_enabled: boolean`
- `current_attempt_id: string | null`
- `latest_requested_change_note_id: string | null`
- `latest_review_package_id: string | null`
- `queue_entered_at: string | null`
- `started_at: string | null`
- `completed_at: string | null`
- `last_heartbeat_at: string | null`
- `last_summary: string | null`

ExecutionAttempt:
- `id: string`
- `session_id: string`
- `attempt_number: number`
- `status: "running" | "interrupted" | "failed" | "completed"`
- `pty_pid: number | null`
- `started_at: string`
- `ended_at: string | null`
- `end_reason: string | null`

StructuredEvent:
- `id: string`
- `occurred_at: string`
- `entity_type: "ticket" | "session" | "attempt" | "worktree" | "git" | "pull_request"`
- `entity_id: string`
- `event_type: string`
- `payload: object`

ReviewPackage:
- `id: string`
- `ticket_id: number`
- `session_id: string`
- `diff_ref: string`
- `commit_refs: string[]`
- `change_summary: string`
- `validation_results: ValidationResult[]`
- `remaining_risks: string[]`
- `created_at: string`

Notes on persisted ownership:
- `DraftTicketState` is the persisted record used by the refinement drawer before a ticket becomes `ready`.
- Ticket records in SQLite are the canonical persisted artifact once a draft becomes `ready`; no companion ticket Markdown file should be created on disk.
- `RequestedChangeNote` records must remain available to the same logical execution session across retries and resumed attempts.

### 8.4 Planning Semantics
- The formal planning option maps directly to the Codex or model planning flag.
- The application does not need its own separate planning engine.
- The application only needs to track whether execution was launched with planning enabled and to display the resulting plan summary.

### 8.5 GitHub and PR Integration
- GitHub and pull request operations should be performed via the GitHub CLI `gh` and local git commands.
- The system must support actions such as:
  - Create PR
  - Check PR status
  - Merge PR
  - Rebase branch
- PRs must be linked to their associated tickets.
- Board cards and ticket details should expose PR status where relevant.

#### External Reconciliation Policy
- The system must reconcile ticket state against external git and GitHub state.
- Reconciliation should run:
  - On backend startup
  - On explicit user refresh
  - Periodically while the app is open
- For tickets in `Review` with linked PRs, reconciliation should refresh:
  - PR state
  - Merge state
  - Head branch existence
  - Latest commit metadata
- If a linked PR is detected as merged, the ticket should transition to `Done`.
- If a linked PR is closed without merge, the ticket should remain in `Review` and surface the closed state for user action.
- If the target branch has moved ahead while a ticket is in `Review`, the system should surface that drift before direct merge.
- Direct merge should rebase the working branch onto the latest target branch before final merge.
- If rebase produces conflicts, the ticket should return to `In Progress` with a merge-conflict note.
- After successful PR merge, remote branch deletion should default to enabled when supported and safe.

### 8.6 Worktree Lifecycle Hooks
- The system should support optional commands or scripts that run during worktree lifecycle events.
- Hooks are configured per repository.
- At minimum, hooks should be supported for:
  - Worktree creation
  - Worktree removal
- Example use case: running `npm install` after creating a worktree.
- Hooks may be used to prepare repository-specific development environments.

#### Hook Execution Policy
- Hooks should run as backend-owned subprocesses rather than browser-owned commands.
- Hook output must be captured and attached to structured events.
- Each hook must define:
  - Command
  - Working directory
  - Timeout
  - Failure policy
- Recommended failure policies are:
  - `block`: fail the parent operation
  - `warn`: continue but surface a warning
  - `ignore`: record the result without blocking or warning
- The default worktree-creation hook policy should be `block`.
- The default worktree-removal hook policy should be `warn`.

### 8.7 Docker Execution Environment
- Each execution session must run through a Docker-backed agent CLI runtime.
- Docker is the only supported execution backend for ticket execution.
- Supported agent adapters are Codex CLI and Claude Code, both launched inside the managed Docker runtime.
- The selected agent CLI should provide the execution sandbox and command policy boundary for autonomous work.
- The walleyboard should own worktree preparation, session lifecycle, launch context, structured event capture, and workflow-level approvals.
- Planning-first runs should launch the selected agent with read-only behavior.
- Implementation runs should launch the selected agent with workspace-write behavior against the prepared worktree.
- Minimum Docker setup must be documented as: Docker Desktop or Docker Engine installed, the daemon running, and `docker version` succeeding in the same shell environment as the backend.
- Codex runs must mount the host `~/.codex` directory into the container, and Claude Code runs must mount the host `~/.claude` directory into the container.
- Validation commands and hooks should continue to run as backend-owned subprocesses against that same worktree.
- The walleyboard should not add a second OS-level sandbox layer in v1.

#### Credential and Summary Safety
- `gh` authentication should use the user's existing local GitHub CLI credentials rather than storing duplicate credentials inside the application.
- Git author name and email should use existing local git configuration unless explicitly overridden by repository configuration.
- The application must not write credentials into ticket Markdown, structured events, or agent-generated summaries.
- Structured events and generated summaries should redact configured secret values before persistence.
- Raw logs may be stored locally, but any derived summaries or indexed payloads must be redacted.

#### Resource and Timeout Policy
- Each execution attempt should have backend-enforced resource limits in addition to any limits suggested by the runtime
- Validation commands and hooks must use their configured per-command timeouts
- The backend should define a default timeout for Codex idle heartbeat loss before a session is considered `interrupted`
- The backend should define a maximum log chunk size for streamed PTY output to avoid unbounded memory pressure

#### Approval and Control Boundaries
- Codex execution policy is the safety boundary for autonomous work, not a replacement for workflow-level approvals
- Codex may operate autonomously within its execution policy and repository policy, but the walleyboard must still require explicit user action for:
  - Starting execution
  - Validation override
  - Direct merge
  - PR creation if that action remains user-initiated
- The backend must not assume it can inspect or veto every sub-command Codex executes inside the CLI runtime
- Therefore the walleyboard must choose Codex execution settings that keep autonomous execution acceptable even when command-by-command mediation is unavailable

### 8.8 Recommended Technical Stack
The recommended v1 stack is:
- Language: TypeScript across frontend and backend
- Runtime: Node.js LTS
- Frontend app: React
- Frontend tooling: Vite
- UI component library: Mantine
- Optional manual terminal UI: xterm.js
- Interactive terminal backend: `node-pty`
- Non-interactive process execution: Node.js `child_process`
- Local database: SQLite
- Ticket storage: SQLite records with Markdown-preserving text fields
- Validation and schema parsing: Zod
- Formatting and linting: Biome
- Git hooks: Husky
- GitHub integration: local `git` and `gh` CLI commands

#### Recommended Dependencies by Feature Area
The implementation should prefer mature libraries for generic UI, data, and editor concerns so custom code can focus on orchestration-specific behavior.

Board and drag-and-drop:
- `@dnd-kit/react`
- `@dnd-kit/sortable`
- Use for Kanban columns, card movement, and sortable interactions

Data fetching, mutations, and refresh:
- `@tanstack/react-query`
- Use for project, ticket, session, review, and PR queries plus polling and cache invalidation

Forms and validation:
- `react-hook-form`
- `zod`
- `@hookform/resolvers`
- Use for ticket creation, ticket editing, repository configuration, and the refinement wizard

Markdown rendering and authored text handling:
- `react-markdown`
- Use for rendering human-authored draft and ticket Markdown plus related summaries

Logs, events, and large lists:
- `react-virtuoso`
- Use for structured event views, terminal-adjacent log panes, and large card or ticket lists

Diff and review UI:
- `react-diff-view`
- Use as the default v1 diff renderer for review packages backed by unified diff text from git
- Optional future upgrade:
  - `monaco-editor`
  - `@monaco-editor/react`
  - Only introduce if the product later needs editor-grade diff or code browsing beyond basic review

Backend API and realtime transport:
- `fastify`
- `@fastify/websocket`
- Use for the local backend API, command endpoints, and event or PTY stream transport

Database and persistence:
- `drizzle-orm`
- `drizzle-kit`
- `better-sqlite3`
- Use for local SQLite storage, migrations, and typed database access

Process execution:
- `node-pty`
- `execa`
- Use `node-pty` for interactive Codex sessions and terminal processes
- Use `execa` for non-interactive commands such as validation, hooks, git metadata reads, and status checks

Utilities:
- `nanoid`
- Use for stable local IDs for sessions, events, and persisted records

#### Stack Rationale
- TypeScript end-to-end keeps domain types shared across board state, ticket parsing, session state, and backend orchestration logic.
- Node.js is the best fit for managing local processes, PTYs, filesystem state, git operations, `gh`, and Codex launches from one runtime.
- React plus Mantine fits a dense board-first power-user UI with drawers, panels, forms, badges, tables, and status-heavy workflows.
- xterm.js is an optional fit for a future manual project terminal, but the main session view should still prefer interpreted agent activity over raw transcripts.
- `node-pty` should back all interactive Codex CLI sessions and any future manual terminal so the application gets real PTY behavior rather than a plain pipe-based subprocess.
- `child_process` should handle simpler non-interactive commands such as status checks, git metadata reads, or hook execution when PTY behavior is not required.
- SQLite is the right default for local-first indexed state such as projects, ticket metadata, session metadata, queue state, and structured events.
- SQLite-backed ticket records preserve human-authored Markdown while keeping orchestration fields explicit and queryable.
- Zod should validate ticket records, persisted configuration, IPC payloads, and session event payloads.
- Biome keeps the JavaScript and TypeScript toolchain lean by covering formatting and linting in one tool.
- Husky should enforce lightweight local quality gates such as formatting, linting, and fast tests before commit.

#### Dependency Selection Guidance
- Prefer libraries for generic concerns such as drag-and-drop, form state, markdown rendering, virtualization, diff rendering, database access, and realtime transport.
- Avoid writing custom implementations for those concerns unless a library fails a concrete product requirement.
- Keep custom code focused on:
  - Ticket lifecycle orchestration
  - Codex session lifecycle
  - Worktree management
  - Queueing and scheduling
  - Git and PR reconciliation
  - Sandboxing and credential boundaries
- Start with `react-diff-view` for v1 review screens instead of building a custom diff renderer.
- Do not introduce Monaco-based code viewing in v1 unless simple diff rendering proves insufficient.

#### Packaging Direction
- V1 should be implemented as a local web application with a Node.js backend running on the same machine.
- Desktop packaging is not required for v1.
- If desktop packaging becomes desirable later, the architecture should remain compatible with packaging options such as Tauri.

## 9. UX Direction
- Board-first layout
- Ticket detail drawer for creation and refinement
- Ticket detail panel or split view for interpreted activity, structured events, diffs, and metadata
- Clear distinction between:
  - Ticket refinement
  - Queued execution
  - Active execution
  - Review

## 10. Implementation Readiness Checklist
Before implementation begins, the v1 build should treat the following as frozen contracts:
- Ticket lifecycle states and allowed transitions
- Execution session states and resume semantics
- Codex adapter contract and autonomy policy
- Ticket record schema
- Repository configuration schema
- Validation command schema
- Review package schema
- Structured event schema
- Backend ownership of long-running work, PTYs, scheduling, and reconciliation
- Direct-merge policy of rebase-then-merge
- Default remote branch deletion after successful PR merge
- Default hook failure policies

## 11. Strict MVP Slice
The PRD above describes the target v1 product direction. The initial implementation must use a stricter MVP slice.

MVP rule:
- If a feature is described elsewhere in this PRD but listed as deferred below, the deferred status wins for the initial implementation.

### 11.1 MVP Goal
The MVP should prove one reliable end-to-end workflow:
1. Select a project
2. Create a draft ticket with title and description
3. Run AI-assisted refinement
4. Save an execution-ready ticket
5. Start ticket execution in a dedicated worktree
6. Receive in-app notification when user input or approval is required
7. Review the resulting diff, commits, validation results, and summary
8. Request changes or merge directly
9. Mark the ticket `done` and clean up local artifacts

### 11.2 Included in MVP
- Single-user local web application with local backend
- Manual project and repository configuration
- Drafts visible in a dedicated `Draft` board column before promotion to `Ready`
- One repository per ticket
- Ticket states:
  - `draft`
  - `ready`
  - `in_progress`
  - `review`
  - `done`
- Persisted draft refinement flow
- Basic AI-assisted ticket refinement including:
  - wording improvements
  - missing-information prompts
  - feasibility feedback
  - acceptance-criteria drafting
  - repository confirmation
- One logical execution session per ticket
- Per-project concurrency limits with queued follow-on starts once the active-session limit is reached
- Docker-backed ticket execution only, with Codex and Claude Code as supported agent runtimes
- Interpreted session activity view with summaries and required-action prompts
- In-app waiting-state notifications when the session needs user input or approval
- Inbox items and alert sounds only for newly actionable human work:
  drafts awaiting confirmation, review tickets awaiting human review after AI review settles, and sessions that are truly paused or failed for operator input rather than briefly passing through an inbox-eligible state during refresh or automatic relaunch
- Card-level diff, terminal, preview, and activity actions, with diff/terminal/activity opening in large modal workspaces
- Activity access retained from the card and inspector even after worktree cleanup
- Plain xterm.js worktree terminal access without agent takeover controls on that surface, gated off only while a live agent process still owns the worktree
- Repo-configured validation commands
- Review package generation with:
  - diff
  - commit list
  - validation results
  - summary
  - remaining risks
- Request-changes loop back to the same ticket, worktree, branch, and session
- Explicit stop action that preserves the in-progress ticket and existing worktree for manual resume
- Interrupted-session restart from scratch after tearing down the preserved workspace
- Ticket deletion with best-effort cleanup of walleyboard-owned local artifacts
- Direct merge flow with rebase-then-merge
- Local worktree and local branch cleanup after successful merge
- Archive and restore for completed tickets
- Ticket Markdown plus SQLite-backed indexed state

### 11.3 Explicitly Deferred from MVP
- Pull request creation from the app
- GitHub polling and external PR reconciliation
- Remote branch deletion
- Automatic ticket splitting into multiple created tickets
- Cross-repository execution from a single ticket
- Automatic live PTY reattachment after backend restart
- Desktop or operating-system-level notifications
- Monaco-based code or diff viewing
- Fine-grained network domain allowlisting
- Cleanup hooks

### 11.4 MVP-Specific Simplifications
- If the backend restarts while a session is running, the session may conservatively move to `interrupted` and require explicit manual resume.
- The refinement flow may present split-ticket advice, but MVP does not need to create multiple child tickets automatically.
- Review in MVP is a local review experience and does not require GitHub PR objects.
- Queueing may remain a simple per-project FIFO flow without cross-project prioritization.
- In-app notifications are sufficient for MVP as long as waiting states are visible and hard to miss.
- In-app inbox entries and sounds should key off stable human-actionable states only; transient status churn during refresh, AI-review handoff, request-changes relaunch, or other auto-resume transitions must not create a fresh alert.
- GitHub CLI credentials are not required for the MVP path unless a later feature flag enables PR operations.

### 11.5 Suggested MVP Build Order
1. Local backend, SQLite schema, and ticket storage
2. Project and repository configuration
3. Draft ticket drawer and persisted refinement flow
4. Worktree creation plus Codex execution adapter
5. Interpreted session activity view and session state updates
6. Validation runner and review package generation
7. Direct merge flow and cleanup

## 12. Open Questions
- What should the ticket detail layout prioritize first: interpreted activity, structured events, diff view, or metadata?
- Should project configuration later support repo descriptions, test commands, environment variables, or secrets references?

## 13. Suggested Next Expansion Areas
The next iteration should define:
- Separate manual terminal UX and checkpoint UX
- Review screen UX for diffs, summaries, and approval actions
- Persistence model and local database design
- Safety controls and approval checkpoints
