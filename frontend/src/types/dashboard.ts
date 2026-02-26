import type { BeadInfo, CrewMember, GastownStatus, Message, EpicWithProgressResponse } from './index';

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

/** Epic category for dashboard display */
export interface EpicCategory {
  items: EpicWithProgressResponse[];
  totalCount: number;
}

/** Mail summary for dashboard */
export interface MailSummary {
  recentMessages: Message[];
  totalCount: number;
  unreadCount: number;
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
  epics: DashboardSection<{
    inProgress: EpicCategory;
    completed: EpicCategory;
  }>;
  mail: DashboardSection<MailSummary>;
  timestamp: string;
}
