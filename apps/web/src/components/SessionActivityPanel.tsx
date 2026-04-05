import { Tabs } from "@mantine/core";
import { useState } from "react";
import type {
  ExecutionAttempt,
  ExecutionSession,
  ReviewRun,
  StructuredEvent,
} from "../../../../packages/contracts/src/index.js";
import { SessionActivityFeed } from "./SessionActivityFeed.js";
import { SessionActivityTimeline } from "./SessionActivityTimeline.js";

type ActivityTab = "overview" | "timeline";

export function SessionActivityPanel({
  attempts,
  logs,
  reviewRuns,
  session,
  ticketEvents,
  timelineError,
  timelinePending,
}: {
  attempts: ExecutionAttempt[];
  logs: string[];
  reviewRuns: ReviewRun[];
  session: ExecutionSession;
  ticketEvents: StructuredEvent[];
  timelineError: string | null;
  timelinePending: boolean;
}) {
  const [activeTab, setActiveTab] = useState<ActivityTab>("overview");

  return (
    <Tabs
      className="ticket-workspace-tabs"
      keepMounted={false}
      value={activeTab}
      onChange={(value) => {
        if (value === "timeline" || value === "overview") {
          setActiveTab(value);
        }
      }}
    >
      <Tabs.List>
        <Tabs.Tab value="overview">Overview</Tabs.Tab>
        <Tabs.Tab value="timeline">Timeline</Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel className="ticket-workspace-tab-panel" value="overview">
        <SessionActivityFeed logs={logs} session={session} />
      </Tabs.Panel>

      <Tabs.Panel className="ticket-workspace-tab-panel" value="timeline">
        <SessionActivityTimeline
          attempts={attempts}
          error={timelineError}
          events={ticketEvents}
          isLoading={timelinePending}
          logs={logs}
          reviewRuns={reviewRuns}
          session={session}
        />
      </Tabs.Panel>
    </Tabs>
  );
}
