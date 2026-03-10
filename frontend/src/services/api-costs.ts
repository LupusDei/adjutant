/**
 * Cost API client methods for the Adjutant cost tracking endpoints.
 * Separated from the main api.ts to keep cost concerns modular.
 */

// Reuse the same base fetch infrastructure
const API_BASE_URL = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api';

/** Reconciliation status indicating cost data confidence level. */
export type ReconciliationStatus = 'estimated' | 'verified' | 'discrepancy';

/** Session cost entry from the backend CostTracker. */
export interface CostEntry {
  sessionId: string;
  projectPath: string;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  cost: number;
  lastUpdated: string;
  /** Agent name associated with this session */
  agentId?: string;
  /** Cost reconciliation status — optional for backward compat */
  reconciliationStatus?: ReconciliationStatus;
  /** JSONL-derived cost (ground truth), present when reconciliation has run */
  jsonlCost?: number;
}

/** Full cost summary from GET /api/costs. */
export interface CostSummary {
  totalCost: number;
  totalTokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  sessions: Record<string, CostEntry>;
  projects: Record<string, ProjectCostSummary>;
}

/** Per-project cost summary. */
export interface ProjectCostSummary {
  projectPath: string;
  totalCost: number;
  totalTokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  sessionCount: number;
}

/** Burn rate data from GET /api/costs/burn-rate. */
export interface BurnRate {
  rate10m: number;
  rate1h: number;
  trend: 'increasing' | 'stable' | 'decreasing';
}

/** Budget record from GET /api/costs/budget. */
export interface BudgetRecord {
  id: number;
  scope: 'session' | 'project';
  scopeId: string | null;
  budgetAmount: number;
  warningPercent: number;
  criticalPercent: number;
  createdAt: string;
  updatedAt: string;
}

/** Per-bead cost result from GET /api/costs/by-bead/:id. */
export interface BeadCostResult {
  beadId: string;
  totalCost: number;
  sessions: Array<{
    sessionId: string;
    cost: number;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  }>;
  tokenBreakdown: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

/** Reconciliation result from GET /api/costs/reconcile. */
export interface ReconciliationResult {
  sessionId: string;
  statuslineCost: number;
  jsonlCost: number;
  difference: number;
  percentDiff: number;
  status: 'verified' | 'discrepancy';
}

// Re-export the getApiKey function for auth headers
function getApiKey(): string | null {
  return sessionStorage.getItem('adjutant-api-key');
}

/**
 * Internal fetch wrapper for cost endpoints.
 * Follows the same pattern as the main api.ts apiFetch.
 */
async function costFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const apiKey = getApiKey();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string> | undefined) },
  });

  const json = (await response.json()) as { success: boolean; data?: T; error?: { code: string; message: string } };

  if (!json.success) {
    throw new Error(json.error?.message ?? 'Unknown cost API error');
  }

  return json.data as T;
}

/**
 * Cost API client.
 */
export const costApi = {
  /** Fetch the full cost summary. */
  async fetchCostSummary(): Promise<CostSummary> {
    return costFetch<CostSummary>('/costs');
  },

  /** Fetch current burn rate. */
  async fetchBurnRate(): Promise<BurnRate> {
    return costFetch<BurnRate>('/costs/burn-rate');
  },

  /** Fetch all budgets with status. */
  async fetchBudgets(): Promise<BudgetRecord[]> {
    return costFetch<BudgetRecord[]>('/costs/budget');
  },

  /** Fetch cost for a specific bead, optionally with children for epic aggregation. */
  async fetchBeadCost(beadId: string, children?: string[]): Promise<BeadCostResult> {
    const params = children && children.length > 0
      ? `?children=${children.join(',')}`
      : '';
    return costFetch<BeadCostResult>(`/costs/by-bead/${encodeURIComponent(beadId)}${params}`);
  },

  /** Create or update a budget. */
  async createBudget(params: {
    scope: 'session' | 'project';
    scopeId?: string;
    amount: number;
    warningPercent?: number;
    criticalPercent?: number;
  }): Promise<BudgetRecord> {
    return costFetch<BudgetRecord>('/costs/budget', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  /** Delete a budget by ID. */
  async deleteBudget(id: number): Promise<{ deleted: boolean }> {
    return costFetch<{ deleted: boolean }>(`/costs/budget/${id}`, {
      method: 'DELETE',
    });
  },

  /** Reconcile all active sessions against JSONL data. */
  async fetchReconciliation(): Promise<ReconciliationResult[]> {
    return costFetch<ReconciliationResult[]>('/costs/reconcile');
  },

  /** Reconcile a specific session against JSONL data. */
  async fetchSessionReconciliation(sessionId: string): Promise<ReconciliationResult> {
    return costFetch<ReconciliationResult>(`/costs/reconcile/${encodeURIComponent(sessionId)}`);
  },
};
