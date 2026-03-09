// ============================================================================
// Enums and Primitives
// ============================================================================

/** Communication priority levels for connection management. */
export type CommunicationPriority = 'real-time' | 'efficient' | 'polling-only';

/** Connection status for the communication indicator. */
export type ConnectionStatus = 'websocket' | 'sse' | 'polling' | 'reconnecting' | 'disconnected';

/** Possible statuses for a crew member. */
export type CrewMemberStatus =
  | "idle"
  | "working"
  | "blocked"
  | "stuck"
  | "offline";

/** Agent types in the system. */
export type AgentType =
  | "user"
  | "agent";

// ============================================================================
// Crew Member Types
// ============================================================================

/** A crew member displayed in the stats dashboard. */
export interface CrewMember {
  /** Unique identifier (e.g., "greenplace/Toast") */
  id: string;
  /** Display name */
  name: string;
  /** Agent type for icon/styling */
  type: AgentType;
  /** Which project this agent belongs to (null for unscoped) */
  project: string | null;
  /** Current operational status */
  status: CrewMemberStatus;
  /** Current task description (if working) */
  currentTask?: string;
  /** Number of unread messages */
  unreadMail: number;
  /** First unread message subject (for preview) */
  firstSubject?: string;
  /** Sender of first unread message (for preview) */
  firstFrom?: string;
  /** Current git branch */
  branch?: string;
  /** Session ID for linking to session chat (swarm) */
  sessionId?: string;
  /** ISO timestamp of last activity (from session registry) */
  lastActivity?: string;
  /** Git worktree path (swarm agents working in worktrees) */
  worktreePath?: string;
  /** Task progress for this agent (completed/total from assigned beads) */
  progress?: { completed: number; total: number };
  /** Which swarm this agent belongs to (swarm mode) */
  swarmId?: string;
  /** Whether this agent is the merge coordinator (swarm mode) */
  isCoordinator?: boolean;
  /** Session cost in dollars (from backend CostTracker) */
  cost?: number;
  /** Estimated context window usage percentage (0-100) */
  contextPercent?: number;
}

// ============================================================================
// Bead Types
// ============================================================================

/** Bead display info for the UI. */
export interface BeadInfo {
  /** Bead ID (e.g., "gb-53tj") */
  id: string;
  /** Bead title */
  title: string;
  /** Status (open, closed, etc.) */
  status: string;
  /** Priority (0-4, lower = higher priority) */
  priority: number;
  /** Issue type (feature, bug, task, etc.) */
  type: string;
  /** Assignee address or null */
  assignee: string | null;
  /** Project name extracted from assignee or null for top-level */
  project: string | null;
  /** Source database: "town" for hq-*, or project name for project-specific beads */
  source: string;
  /** Labels attached to the bead */
  labels: string[];
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string | null;
}

/** Extended bead info with full details for detail view. */
export interface BeadDetail extends BeadInfo {
  /** Full description (markdown) */
  description: string;
  /** Timestamp when bead was closed */
  closedAt: string | null;
  /** Hooked bead ID */
  hookBead: string | null;
  /** Role bead ID */
  roleBead: string | null;
  /** Agent state (working, idle, stuck, stale) */
  agentState: string | null;
  /** Whether bead is pinned */
  pinned: boolean;
  /** Dependency relationships */
  dependencies: BeadDependency[];
}

/** Bead dependency relationship. */
export interface BeadDependency {
  /** The bead that has this dependency */
  issueId: string;
  /** The bead it depends on */
  dependsOnId: string;
  /** Dependency type (blocks, blocked_by, etc.) */
  type: string;
}

/** Epic with server-computed progress from dependency graph. */
export interface EpicWithProgressResponse {
  /** The epic bead info */
  epic: BeadInfo;
  /** Child beads (empty in list view, populated in detail view) */
  children: BeadInfo[];
  /** Total number of children */
  totalCount: number;
  /** Number of closed children */
  closedCount: number;
  /** Progress as a decimal (0-1) */
  progress: number;
}

// ============================================================================
// API Response Types
// ============================================================================

/** Standard API response envelope. */
export interface ApiResponse<T> {
  /** Whether the request succeeded */
  success: boolean;
  /** Response data (present if success=true) */
  data?: T;
  /** Error information (present if success=false) */
  error?: {
    code: string;
    message: string;
    details?: string;
  };
  /** Response timestamp */
  timestamp: string;
}

/** Paginated list response. */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

// Endpoint-specific response types
export type AgentsResponse = ApiResponse<CrewMember[]>;

// ============================================================================
// Chat Message Types (SQLite-backed persistent messages)
// ============================================================================

/** A persistent chat message from the message store. */
export interface ChatMessage {
  id: string;
  sessionId: string | null;
  agentId: string;
  recipient: string | null;
  role: 'user' | 'agent' | 'system' | 'announcement';
  body: string;
  metadata: Record<string, unknown> | null;
  deliveryStatus: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  eventType: string | null;
  threadId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Thread summary from the messages API. */
export interface ChatThread {
  threadId: string;
  messageCount: number;
  latestBody: string;
  latestCreatedAt: string;
  agentId: string;
}

/** Unread count per agent. */
export interface UnreadCount {
  agentId: string;
  count: number;
}

export type ProposalType = 'product' | 'engineering';
export type ProposalStatus = 'pending' | 'accepted' | 'dismissed' | 'completed';

export interface Proposal {
  id: string;
  author: string;
  title: string;
  description: string;
  project: string;
  type: ProposalType;
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SessionInfo {
  id: string;
  name: string;
  tmuxSession: string;
  tmuxPane: string;
  projectPath: string;
  status: string;
  workspaceType: string;
  connectedClients: string[];
  pipeActive: boolean;
  createdAt: string;
  lastActivity: string;
}

// ============================================================================
// Project Types
// ============================================================================

/** A registered project in the system. */
export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  gitRemote?: string;
  sessions: string[];
  createdAt: string;
  active: boolean;
  hasBeads?: boolean;
}

/** Health check result for a project. */
export interface ProjectHealth {
  projectId: string;
  pathExists: boolean;
  hasGit: boolean;
  hasBeads: boolean;
  gitRemote?: string;
  status: 'healthy' | 'degraded' | 'stale';
}

// ============================================================================
// Persona Types
// ============================================================================

/** The 12 personality trait dimensions. */
export const PersonaTrait = {
  ARCHITECTURE_FOCUS: 'architecture_focus',
  PRODUCT_DESIGN: 'product_design',
  UIUX_FOCUS: 'uiux_focus',
  QA_SCALABILITY: 'qa_scalability',
  QA_CORRECTNESS: 'qa_correctness',
  TESTING_UNIT: 'testing_unit',
  TESTING_ACCEPTANCE: 'testing_acceptance',
  MODULAR_ARCHITECTURE: 'modular_architecture',
  BUSINESS_OBJECTIVES: 'business_objectives',
  TECHNICAL_DEPTH: 'technical_depth',
  CODE_REVIEW: 'code_review',
  DOCUMENTATION: 'documentation',
} as const;

export type PersonaTraitKey = (typeof PersonaTrait)[keyof typeof PersonaTrait];

/** All trait keys as an array for iteration. */
export const PERSONA_TRAIT_KEYS: readonly PersonaTraitKey[] = Object.values(PersonaTrait);

/** Trait values object mapping each trait key to its point allocation (0-20). */
export type TraitValues = Record<PersonaTraitKey, number>;

/** Maximum points per trait. */
export const TRAIT_MAX = 20;

/** Total point budget across all traits. */
export const POINT_BUDGET = 100;

/** A persona entity as returned by the API. */
export interface Persona {
  id: string;
  name: string;
  description: string;
  traits: TraitValues;
  createdAt: string;
  updatedAt: string;
}

/** Input for creating a new persona. */
export interface CreatePersonaInput {
  name: string;
  description?: string;
  traits: TraitValues;
}

/** Input for updating an existing persona. */
export interface UpdatePersonaInput {
  name?: string;
  description?: string;
  traits?: TraitValues;
}

/** Callsign setting from the API. */
export interface CallsignSetting {
  name: string;
  enabled: boolean;
}

/** Callsign list response shape. */
export interface CallsignListResponse {
  callsigns: CallsignSetting[];
  masterEnabled: boolean;
}

/** Trait grouping for UI display. */
export interface TraitGroup {
  key: string;
  label: string;
  traits: PersonaTraitKey[];
}

/** Trait display metadata for rendering sliders. */
export interface TraitDisplayInfo {
  key: PersonaTraitKey;
  label: string;
  description: string;
  group: string;
}

/** The 4 cognitive trait groups per designer specs. */
export const TRAIT_GROUPS: readonly TraitGroup[] = [
  {
    key: 'engineering',
    label: 'ENGINEERING',
    traits: [PersonaTrait.ARCHITECTURE_FOCUS, PersonaTrait.MODULAR_ARCHITECTURE, PersonaTrait.TECHNICAL_DEPTH],
  },
  {
    key: 'quality',
    label: 'QUALITY',
    traits: [PersonaTrait.QA_CORRECTNESS, PersonaTrait.QA_SCALABILITY, PersonaTrait.TESTING_UNIT, PersonaTrait.TESTING_ACCEPTANCE],
  },
  {
    key: 'product',
    label: 'PRODUCT',
    traits: [PersonaTrait.PRODUCT_DESIGN, PersonaTrait.UIUX_FOCUS, PersonaTrait.BUSINESS_OBJECTIVES],
  },
  {
    key: 'craft',
    label: 'CRAFT',
    traits: [PersonaTrait.CODE_REVIEW, PersonaTrait.DOCUMENTATION],
  },
] as const;

/** Display label mapping per designer recommendations (adj-b93s). */
export const TRAIT_DISPLAY: Record<PersonaTraitKey, TraitDisplayInfo> = {
  [PersonaTrait.ARCHITECTURE_FOCUS]: {
    key: PersonaTrait.ARCHITECTURE_FOCUS,
    label: 'SYSTEM DESIGN',
    description: 'System design, dependency management, clean abstractions',
    group: 'engineering',
  },
  [PersonaTrait.MODULAR_ARCHITECTURE]: {
    key: PersonaTrait.MODULAR_ARCHITECTURE,
    label: 'MODULARITY',
    description: 'Separation of concerns, clean interfaces, composability',
    group: 'engineering',
  },
  [PersonaTrait.TECHNICAL_DEPTH]: {
    key: PersonaTrait.TECHNICAL_DEPTH,
    label: 'DEEP TECH',
    description: 'Low-level knowledge, performance optimization, algorithms',
    group: 'engineering',
  },
  [PersonaTrait.QA_CORRECTNESS]: {
    key: PersonaTrait.QA_CORRECTNESS,
    label: 'CORRECTNESS',
    description: 'Functional correctness, edge cases, does everything work',
    group: 'quality',
  },
  [PersonaTrait.QA_SCALABILITY]: {
    key: PersonaTrait.QA_SCALABILITY,
    label: 'SCALE TESTING',
    description: 'Performance testing, load handling, scaling concerns',
    group: 'quality',
  },
  [PersonaTrait.TESTING_UNIT]: {
    key: PersonaTrait.TESTING_UNIT,
    label: 'UNIT TESTS',
    description: 'Unit test rigor, TDD discipline, mock strategies',
    group: 'quality',
  },
  [PersonaTrait.TESTING_ACCEPTANCE]: {
    key: PersonaTrait.TESTING_ACCEPTANCE,
    label: 'E2E TESTS',
    description: 'Integration/E2E test coverage, acceptance criteria',
    group: 'quality',
  },
  [PersonaTrait.PRODUCT_DESIGN]: {
    key: PersonaTrait.PRODUCT_DESIGN,
    label: 'PRODUCT DESIGN',
    description: 'Product thinking, user needs, feature completeness',
    group: 'product',
  },
  [PersonaTrait.UIUX_FOCUS]: {
    key: PersonaTrait.UIUX_FOCUS,
    label: 'UI/UX FOCUS',
    description: 'Visual design, interaction patterns, accessibility',
    group: 'product',
  },
  [PersonaTrait.BUSINESS_OBJECTIVES]: {
    key: PersonaTrait.BUSINESS_OBJECTIVES,
    label: 'BIZ VALUE',
    description: 'Business value alignment, ROI thinking, prioritization',
    group: 'product',
  },
  [PersonaTrait.CODE_REVIEW]: {
    key: PersonaTrait.CODE_REVIEW,
    label: 'CODE REVIEW',
    description: 'Review thoroughness, attention to detail, mentoring',
    group: 'craft',
  },
  [PersonaTrait.DOCUMENTATION]: {
    key: PersonaTrait.DOCUMENTATION,
    label: 'DOCUMENTATION',
    description: 'Code comments, README, API docs, inline documentation',
    group: 'craft',
  },
};

/** Compute the sum of all trait values. */
export function sumTraits(traits: TraitValues): number {
  return PERSONA_TRAIT_KEYS.reduce((sum, key) => sum + traits[key], 0);
}

/** Create a zeroed-out trait values object. */
export function emptyTraits(): TraitValues {
  const traits = {} as Record<string, number>;
  for (const key of PERSONA_TRAIT_KEYS) {
    traits[key] = 0;
  }
  return traits as TraitValues;
}

export * from './epics';
export * from './kanban';
export * from './beads-graph';
