import type { BeadInfo, CrewMember, GastownStatus, Message } from './index';

/** Generic section wrapper — each section can independently succeed or fail */
export interface DashboardSection<T> {
  data: T | null;
  error?: string;
}

/** Beads grouped by status for dashboard display */
export interface BeadCategory {
  items: BeadInfo[];
  totalCount: number;
}

/** Epic progress item for dashboard (no children array — lighter than EpicWithProgressResponse). */
export interface EpicWithProgressItem {
  epic: BeadInfo;
  totalCount: number;
  closedCount: number;
  /** 0–1 decimal */
  progress: number;
}

/** Epic category for dashboard display */
export interface EpicCategory {
  items: EpicWithProgressItem[];
  totalCount: number;
}

/** Mail summary for dashboard */
export interface MailSummary {
  recentMessages: Message[];
  totalCount: number;
  unreadCount: number;
}

/** Unread messages from a single agent, for the overview widget. */
export interface UnreadAgentSummary {
  agentId: string;
  unreadCount: number;
  latestBody: string;
  latestCreatedAt: string;
}

/** Full dashboard response from GET /api/dashboard */
export interface DashboardResponse {
  status: DashboardSection<GastownStatus>;
  beads: DashboardSection<{
    inProgress: BeadCategory;
    open: BeadCategory;
    closed: BeadCategory;
  }>;
  crew: DashboardSection<CrewMember[]>;
  unreadCounts: DashboardSection<Record<string, number>>;
  unreadMessages: DashboardSection<UnreadAgentSummary[]>;
  epics: DashboardSection<{
    inProgress: EpicCategory;
    completed: EpicCategory;
  }>;
  mail: DashboardSection<MailSummary>;
  timestamp: string;
}
