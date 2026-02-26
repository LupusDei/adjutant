/**
 * Types for the batch dashboard endpoint.
 *
 * Each section wraps in DashboardSection<T> so individual
 * data sources can fail independently without killing the
 * entire response.
 */

import type { GastownStatus, CrewMember, Message } from "./index.js";
import type { BeadInfo } from "../services/beads/types.js";

// ============================================================================
// Generic Section Wrapper
// ============================================================================

/** Wraps a dashboard section so it can independently fail. */
export interface DashboardSection<T> {
  data: T | null;
  error?: string;
}

// ============================================================================
// Beads
// ============================================================================

/** A category of beads with capped items and a total count. */
export interface BeadCategory {
  items: BeadInfo[];
  totalCount: number;
}

// ============================================================================
// Epics
// ============================================================================

/** A category of epics with progress info. */
export interface EpicCategory {
  items: EpicWithProgressItem[];
  totalCount: number;
}

/** An epic with server-computed progress (mirrors EpicWithChildren). */
export interface EpicWithProgressItem {
  epic: BeadInfo;
  totalCount: number;
  closedCount: number;
  /** 0–1 decimal */
  progress: number;
}

// ============================================================================
// Mail
// ============================================================================

/** Summarised mail data for the dashboard. */
export interface MailSummary {
  recentMessages: Message[];
  totalCount: number;
  unreadCount: number;
}

// ============================================================================
// Full Dashboard Response
// ============================================================================

/** The complete dashboard payload returned by GET /api/dashboard. */
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
