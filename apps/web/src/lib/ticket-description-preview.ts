export const BOARD_TICKET_DESCRIPTION_PREVIEW_LIMIT = 200;

export function getBoardTicketDescriptionPreview(description: string): string {
  if (description.length <= BOARD_TICKET_DESCRIPTION_PREVIEW_LIMIT) {
    return description;
  }

  return `${description.slice(0, BOARD_TICKET_DESCRIPTION_PREVIEW_LIMIT)}...`;
}
