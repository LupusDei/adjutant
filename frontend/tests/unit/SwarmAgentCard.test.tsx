/**
 * Tests for SwarmAgentCard memoization.
 *
 * adj-139.4.6 — Without React.memo, every Crew Stats poll re-renders every
 * card (10+ DOM mutations × every agent × every 5s). With memo, only cards
 * whose `id`, `status`, `lastActivity`, `currentTask`, `progress`, `cost`,
 * or `contextPercent` actually changed re-render.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import { SwarmAgentCard } from '../../src/components/crew/SwarmAgentCard';
import type { CrewMember } from '../../src/types';

// Mock useTerminalStream — SwarmAgentCard calls it conditionally on `expanded`
// state. We never expand in these tests so the hook stays idle.
vi.mock('../../src/hooks/useTerminalStream', () => ({
  useTerminalStream: () => ({
    content: null,
    error: null,
    loading: false,
    mode: 'idle' as const,
  }),
}));

afterEach(() => {
  cleanup();
});

function makeAgent(overrides: Partial<CrewMember> = {}): CrewMember {
  return {
    id: 'agent-1',
    name: 'engineer-d-virt',
    type: 'agent',
    project: 'adjutant',
    status: 'working',
    currentTask: 'Doing task',
    lastActivity: new Date().toISOString(),
    ...overrides,
  };
}

describe('SwarmAgentCard memoization (adj-139.4.6)', () => {
  it('should render basic card structure', () => {
    const { getByText } = render(<SwarmAgentCard agent={makeAgent()} />);
    expect(getByText(/ENGINEER-D-VIRT/i)).toBeTruthy();
  });

  it('should be wrapped in React.memo (component has memo $$typeof + compare fn)', () => {
    interface MemoLike { $$typeof?: symbol; compare?: unknown }
    const card = SwarmAgentCard as unknown as MemoLike;
    expect(card.$$typeof).toBeDefined();
    expect(typeof card.compare).toBe('function');
  });

  it('should preserve DOM identity when re-rendered with logically-equal agent', () => {
    const agent1 = makeAgent({ id: 'a', name: 'kerrigan', status: 'working', currentTask: 'task A' });
    const agent2 = makeAgent({ id: 'a', name: 'kerrigan', status: 'working', currentTask: 'task A' });

    const { rerender, getByText } = render(<SwarmAgentCard agent={agent1} />);
    const span1 = getByText('KERRIGAN');

    // 50 re-renders with brand-new but logically-equal agent objects
    for (let i = 0; i < 50; i++) {
      rerender(<SwarmAgentCard agent={agent2} />);
    }
    const span2 = getByText('KERRIGAN');
    expect(span1).toBe(span2);
  });

  it('should re-render when status changes', () => {
    const { rerender, getByText, queryByText } = render(
      <SwarmAgentCard agent={makeAgent({ id: 's', status: 'working' })} />,
    );
    expect(getByText(/WORKING/)).toBeTruthy();

    rerender(<SwarmAgentCard agent={makeAgent({ id: 's', status: 'blocked' })} />);
    expect(queryByText(/^WORKING$/)).toBeNull();
    expect(getByText(/BLOCKED/)).toBeTruthy();
  });

  it('should re-render when currentTask changes', () => {
    const { rerender, getByText, queryByText } = render(
      <SwarmAgentCard agent={makeAgent({ id: 't', currentTask: 'task-1' })} />,
    );
    expect(getByText('task-1')).toBeTruthy();

    rerender(<SwarmAgentCard agent={makeAgent({ id: 't', currentTask: 'task-2' })} />);
    expect(queryByText('task-1')).toBeNull();
    expect(getByText('task-2')).toBeTruthy();
  });
});
