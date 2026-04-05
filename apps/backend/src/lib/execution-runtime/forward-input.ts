import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { IPty } from "node-pty";
import type { EventHub } from "../event-hub.js";
import type { ExecutionRuntimePersistence } from "../store.js";
import { hasMeaningfulContent } from "./helpers.js";
import { publishSessionOutput } from "./publishers.js";
import type { ForwardedInputTarget } from "./types.js";

export function forwardExecutionInput(input: {
  activeSession: ChildProcessWithoutNullStreams | undefined;
  body: string;
  eventHub: EventHub;
  manualTerminal:
    | {
        attemptId: string | null;
        pty: IPty;
      }
    | undefined;
  sessionId: string;
  store: ExecutionRuntimePersistence;
}): ForwardedInputTarget | null {
  if (!hasMeaningfulContent(input.body)) {
    return null;
  }

  if (input.manualTerminal) {
    input.manualTerminal.pty.write(`${input.body}\r`);
    publishSessionOutput(
      input.eventHub,
      input.store,
      input.sessionId,
      input.manualTerminal.attemptId ??
        input.store.getSession(input.sessionId)?.current_attempt_id ??
        input.sessionId,
      `[terminal input] ${input.body}`,
    );
    return "terminal";
  }

  if (!input.activeSession) {
    return null;
  }

  if (
    input.activeSession.stdin.destroyed ||
    input.activeSession.stdin.writableEnded ||
    !input.activeSession.stdin.writable
  ) {
    return null;
  }

  const attemptId =
    input.store.getSession(input.sessionId)?.current_attempt_id ??
    input.sessionId;
  input.activeSession.stdin.write(`${input.body}\n`);
  publishSessionOutput(
    input.eventHub,
    input.store,
    input.sessionId,
    attemptId,
    `[agent input]\n${input.body}`,
  );
  return "agent";
}
