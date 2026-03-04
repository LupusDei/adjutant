/** Bead summary for the project overview endpoint. */
export interface OverviewBeadSummary {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: number;
  assignee: string | null;
  createdAt: string;
  updatedAt: string | null;
  closedAt?: string | null;
}

/** Beads grouped by status for the overview. */
export interface BeadsOverview {
  open: OverviewBeadSummary[];
  inProgress: OverviewBeadSummary[];
  recentlyClosed: OverviewBeadSummary[];
}

/** Epic progress info from the overview endpoint. */
export interface EpicProgress {
  id: string;
  title: string;
  status: string;
  totalChildren: number;
  closedChildren: number;
  completionPercent: number;
  assignee?: string | null;
  closedAt?: string | null;
}

/** Epics grouped by status for the overview. */
export interface EpicsOverview {
  inProgress: EpicProgress[];
  recentlyCompleted: EpicProgress[];
}

/** Agent info from the overview endpoint. */
export interface AgentOverview {
  id: string;
  name: string;
  status: string;
  project: string | null;
  currentBead: string | null;
  unreadCount: number;
  sessionId: string | null;
}

/** Unread message summary from the overview endpoint. */
export interface OverviewUnreadSummary {
  agentId: string;
  unreadCount: number;
  latestBody: string;
}

/** Full project overview response from GET /api/projects/:id/overview. */
export interface ProjectOverview {
  project: {
    id: string;
    name: string;
    path: string;
    active: boolean;
  };
  beads: BeadsOverview;
  epics: EpicsOverview;
  agents: AgentOverview[];
  unreadMessages: OverviewUnreadSummary[];
}

/** Global overview response from GET /api/overview (aggregated across all projects). */
export interface GlobalOverview {
  projects: Array<{ id: string; name: string; path: string; active: boolean }>;
  beads: BeadsOverview;
  epics: EpicsOverview;
  agents: AgentOverview[];
  unreadMessages: OverviewUnreadSummary[];
}
