/**
 * Regression test for adj-066.4.8: Budget form silently fails on error.
 * Verifies that handleSetBudget and handleDeleteBudget display error messages
 * to the user instead of silently swallowing exceptions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import type { CostSummary, BurnRate, BudgetRecord } from '../../../src/services/api-costs';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockRefresh = vi.fn();
const mockCreateBudget = vi.fn();
const mockDeleteBudget = vi.fn();

// Default hook return value (no budget set, with summary data)
const baseSummary: CostSummary = {
  totalCost: 42.50,
  totalTokens: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 },
  sessions: {
    's1': {
      sessionId: 's1',
      projectPath: '/test',
      tokens: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 },
      cost: 42.50,
      lastUpdated: new Date().toISOString(),
      agentId: 'test-agent',
    },
  },
  projects: {},
};

const baseBurnRate: BurnRate = {
  rate10m: 0.5,
  rate1h: 3.0,
  trend: 'stable',
};

let hookReturn: {
  summary: CostSummary | null;
  burnRate: BurnRate | null;
  budgets: BudgetRecord[];
  loading: boolean;
  error: Error | null;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
};

vi.mock('../../../src/hooks/useCostDashboard', () => ({
  useCostDashboard: () => hookReturn,
}));

vi.mock('../../../src/services/api-costs', () => ({
  costApi: {
    createBudget: (...args: unknown[]) => mockCreateBudget(...args),
    deleteBudget: (...args: unknown[]) => mockDeleteBudget(...args),
  },
}));

// Must import AFTER mocks are set up
const { CostPanel } = await import('../../../src/components/dashboard/CostPanel');

describe('CostPanel budget error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookReturn = {
      summary: baseSummary,
      burnRate: baseBurnRate,
      budgets: [],
      loading: false,
      error: null,
      lastUpdated: new Date(),
      refresh: mockRefresh,
    };
    mockRefresh.mockResolvedValue(undefined);
  });

  it('should display error message when budget creation fails', async () => {
    mockCreateBudget.mockRejectedValue(new Error('Network timeout'));

    render(<CostPanel />);

    // Open the budget form
    const setBudgetBtn = screen.getByText('+ SET BUDGET');
    fireEvent.click(setBudgetBtn);

    // Enter an amount and submit
    const input = screen.getByPlaceholderText('Budget amount ($)');
    fireEvent.change(input, { target: { value: '100' } });
    const setBtn = screen.getByText('SET');
    fireEvent.click(setBtn);

    // Error message should appear
    await waitFor(() => {
      expect(screen.getByText(/Network timeout/)).toBeTruthy();
    });
  });

  it('should display error message when budget deletion fails', async () => {
    const budget: BudgetRecord = {
      id: 1,
      scope: 'session',
      scopeId: null,
      budgetAmount: 100,
      warningPercent: 80,
      criticalPercent: 95,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    hookReturn.budgets = [budget];
    mockDeleteBudget.mockRejectedValue(new Error('Server error: 500'));

    render(<CostPanel />);

    // Click the delete button
    const delBtn = screen.getByText('DEL');
    fireEvent.click(delBtn);

    // Error message should appear
    await waitFor(() => {
      expect(screen.getByText(/Server error: 500/)).toBeTruthy();
    });
  });

  it('should display generic error for non-Error exceptions', async () => {
    mockCreateBudget.mockRejectedValue('something weird');

    render(<CostPanel />);

    // Open form and submit
    fireEvent.click(screen.getByText('+ SET BUDGET'));
    const input = screen.getByPlaceholderText('Budget amount ($)');
    fireEvent.change(input, { target: { value: '50' } });
    fireEvent.click(screen.getByText('SET'));

    await waitFor(() => {
      expect(screen.getByText(/Failed to set budget/)).toBeTruthy();
    });
  });

  it('should clear error when opening budget form again', async () => {
    mockCreateBudget.mockRejectedValueOnce(new Error('First failure'));
    mockCreateBudget.mockResolvedValueOnce(undefined);

    render(<CostPanel />);

    // Trigger error
    fireEvent.click(screen.getByText('+ SET BUDGET'));
    const input = screen.getByPlaceholderText('Budget amount ($)');
    fireEvent.change(input, { target: { value: '100' } });
    fireEvent.click(screen.getByText('SET'));

    await waitFor(() => {
      expect(screen.getByText(/First failure/)).toBeTruthy();
    });

    // Cancel form — error should clear
    fireEvent.click(screen.getByText('X'));

    expect(screen.queryByText(/First failure/)).toBeNull();
  });
});
