export interface TrackedIssue {
  id: string;
  title: string;
  status: string;
  assignee?: string;
  issueType?: string;
  updatedAt?: string;
  priority?: number;
}

export interface Convoy {
  id: string;
  title: string;
  status: string;
  /** The rig this convoy is associated with, or null for town-level convoys */
  rig: string | null;
  progress: {
    completed: number;
    total: number;
  };
  trackedIssues: TrackedIssue[];
}