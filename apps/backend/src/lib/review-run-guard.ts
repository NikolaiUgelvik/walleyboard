type ReviewRunReader = {
  getLatestReviewRun(ticketId: number):
    | {
        status?: string | null;
      }
    | null
    | undefined;
};

export const activeAiReviewError =
  "AI review is still running for this ticket. Stop it or wait for it to finish first.";

export function isAiReviewRunning(
  reviewRunReader: ReviewRunReader,
  ticketId: number,
): boolean {
  return reviewRunReader.getLatestReviewRun(ticketId)?.status === "running";
}

export function assertAiReviewNotRunning(
  reviewRunReader: ReviewRunReader,
  ticketId: number,
): void {
  if (isAiReviewRunning(reviewRunReader, ticketId)) {
    throw new Error(activeAiReviewError);
  }
}
