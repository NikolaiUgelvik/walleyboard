import type {
  ExecutionSession,
  Project,
  RepositoryConfig,
  ReviewPackage,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

export type ReviewReadyInput = {
  project: Project;
  repository: RepositoryConfig;
  reviewPackage: ReviewPackage;
  session: ExecutionSession;
  ticket: TicketFrontmatter;
};

export type ReviewReadyHandler = (input: ReviewReadyInput) => Promise<void>;
