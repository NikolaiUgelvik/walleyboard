import type { FastifyReply } from "fastify";
import type { ZodType } from "zod";

import { makeCommandAck } from "./command-ack.js";

export function parseBody<T>(
  reply: FastifyReply,
  schema: ZodType<T>,
  body: unknown
): T | null {
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    reply.code(400).send({
      error: "Invalid request body",
      issues: parsed.error.flatten()
    });
    return null;
  }

  return parsed.data;
}

export function parsePositiveInt(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export function sendNotImplemented(
  reply: FastifyReply,
  message: string,
  resourceRefs: { ticket_id?: number; session_id?: string; draft_id?: string } = {}
): void {
  reply.code(501).send(makeCommandAck(false, message, resourceRefs));
}
