/**
 * ChannelMembersPanel (adj-bqdte) — the channel roster + add-agent picker.
 *
 * The panel shows the current channel membership and an "add agent" picker
 * filtered to agents who are NOT already members. Selecting an agent calls
 * `addMember` and the roster refreshes. The data layers (`useChannelMembers`
 * for the roster, `api.agents.list` for the agent directory) are mocked so this
 * stays a focused interaction test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import type { ChannelMember, CrewMember } from '../../src/types';

const { mockAddMember, mockUseChannelMembers, mockAgentsList } = vi.hoisted(() => ({
  mockAddMember: vi.fn(),
  mockUseChannelMembers: vi.fn(),
  mockAgentsList: vi.fn(),
}));

vi.mock('../../src/hooks/useChannelMembers', () => ({
  useChannelMembers: mockUseChannelMembers,
}));

vi.mock('../../src/services/api', () => {
  const apiObj = { agents: { list: mockAgentsList } };
  return { api: apiObj, default: apiObj };
});

import { ChannelMembersPanel } from '../../src/components/chat/ChannelMembersPanel';

function member(
  memberId: string,
  memberKind: ChannelMember['memberKind'] = 'agent',
  role: ChannelMember['role'] = 'member',
): ChannelMember {
  return { memberId, memberKind, role };
}

function crew(id: string, name = id): CrewMember {
  return { id, name, type: 'agent', project: null, status: 'idle' };
}

function setMembers(members: ChannelMember[], overrides: Record<string, unknown> = {}) {
  mockUseChannelMembers.mockReturnValue({
    members,
    isLoading: false,
    error: null,
    addMember: mockAddMember,
    refresh: vi.fn(),
    ...overrides,
  });
}

describe('ChannelMembersPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddMember.mockResolvedValue(undefined);
    mockAgentsList.mockResolvedValue([crew('raynor'), crew('kerrigan'), crew('tassadar')]);
    setMembers([member('user', 'user', 'owner'), member('raynor')]);
  });

  it('should render the current members', () => {
    render(<ChannelMembersPanel channelId="c1" onClose={() => {}} />);
    expect(screen.getByText('user')).toBeInTheDocument();
    expect(screen.getByText('raynor')).toBeInTheDocument();
  });

  it('should show only agents who are not already members in the picker', async () => {
    render(<ChannelMembersPanel channelId="c1" onClose={() => {}} />);

    // kerrigan + tassadar are addable; raynor is already a member and the
    // operator (user) is never an addable agent.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /kerrigan/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /tassadar/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^add raynor/i })).not.toBeInTheDocument();
  });

  it('should call addMember with the selected agent id', async () => {
    render(<ChannelMembersPanel channelId="c1" onClose={() => {}} />);

    const addBtn = await screen.findByRole('button', { name: /kerrigan/i });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(mockAddMember).toHaveBeenCalledWith('kerrigan');
    });
  });

  it('should render an empty picker hint when every agent is already a member', async () => {
    mockAgentsList.mockResolvedValue([crew('raynor')]);
    setMembers([member('user', 'user', 'owner'), member('raynor')]);
    render(<ChannelMembersPanel channelId="c1" onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/all agents are members/i)).toBeInTheDocument();
    });
  });

  it('should surface the roster error when the members fetch failed', () => {
    setMembers([], { error: new Error('roster unavailable') });
    render(<ChannelMembersPanel channelId="c1" onClose={() => {}} />);
    expect(screen.getByText(/roster unavailable/i)).toBeInTheDocument();
  });

  it('should invoke onClose when the close control is activated', () => {
    const onClose = vi.fn();
    render(<ChannelMembersPanel channelId="c1" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
