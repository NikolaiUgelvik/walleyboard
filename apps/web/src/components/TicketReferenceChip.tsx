import React, { type MouseEventHandler, type ReactNode } from "react";
import type { TicketReference } from "../../../../packages/contracts/src/index.js";

function humanizeTicketStatus(status: TicketReference["status"]): string {
  switch (status) {
    case "in_progress":
      return "In progress";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

type TicketReferenceChipProps = {
  reference: TicketReference;
  className?: string;
  href?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  trailingContent?: ReactNode;
};

export function TicketReferenceChip({
  reference,
  className,
  href,
  onClick,
  trailingContent,
}: TicketReferenceChipProps) {
  const classes = ["ticket-reference-chip", className ?? ""]
    .filter(Boolean)
    .join(" ");

  const content = (
    <React.Fragment>
      <span className="ticket-reference-chip__id">#{reference.ticket_id}</span>
      <span className="ticket-reference-chip__title">{reference.title}</span>
      <span className="ticket-reference-chip__status">
        {humanizeTicketStatus(reference.status)}
      </span>
      {trailingContent}
    </React.Fragment>
  );

  if (href) {
    return (
      <a className={classes} href={href} onClick={onClick}>
        {content}
      </a>
    );
  }

  if (onClick) {
    return (
      <button className={classes} onClick={onClick} type="button">
        {content}
      </button>
    );
  }

  return <span className={classes}>{content}</span>;
}
