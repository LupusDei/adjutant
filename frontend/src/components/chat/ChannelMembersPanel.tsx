/**
 * ChannelMembersPanel (adj-bqdte) — the channel roster + add-agent picker.
 *
 * Rendered as a modal overlay above the channel room. Two stacked sections:
 *  - ROSTER: the current channel members (from `useChannelMembers`), each with
 *    a kind glyph (operator vs agent) and a role badge (owner/member).
 *  - ADD AGENT: the agent directory (`api.agents.list`) filtered to agents who
 *    are NOT already members; clicking a row adds that agent and the roster
 *    refreshes.
 *
 * The two data layers are deliberately distinct: membership is a per-channel
 * concern owned by the hook, while the agent directory is a global lookup. This
 * keeps the panel a thin orchestration layer with no business logic of its own.
 *
 * Accessibility: role="dialog" + aria-modal, Escape closes, every addable agent
 * is a focusable button, and the close control is keyboard reachable.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useChannelMembers } from '../../hooks/useChannelMembers';
import { api } from '../../services/api';
import type { CrewMember } from '../../types';
import './channel-members.css';

export interface ChannelMembersPanelProps {
  /** The open channel's conversation id. */
  channelId: string;
  /** Close the panel (Escape, backdrop click, or the close control). */
  onClose: () => void;
}

function ChannelMembersPanelImpl({ channelId, onClose }: ChannelMembersPanelProps) {
  const { members, isLoading, error, addMember } = useChannelMembers(channelId);

  const [agents, setAgents] = useState<CrewMember[]>([]);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);

  // Load the agent directory once on open. A failure here is non-fatal: the
  // roster still renders; the picker simply shows nothing to add.
  useEffect(() => {
    let active = true;
    void api.agents
      .list()
      .then((list) => {
        if (active) setAgents(list);
      })
      .catch(() => {
        /* picker stays empty on directory failure */
      })
      .finally(() => {
        if (active) setAgentsLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Focus the dialog on mount so Escape works without a prior click, and so
  // screen readers announce the dialog.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  // Addable = directory agents whose id is not already a member id. The
  // operator (`user`) is never an agent in the directory, so no special-casing
  // is needed beyond the membership set.
  const addable = useMemo(() => {
    const memberIds = new Set(members.map((m) => m.memberId));
    return agents.filter((a) => !memberIds.has(a.id));
  }, [agents, members]);

  const handleAdd = useCallback(
    async (agentId: string) => {
      setPendingId(agentId);
      setAddError(null);
      try {
        await addMember(agentId);
      } catch (err) {
        setAddError(err instanceof Error ? err.message : 'Failed to add agent');
      } finally {
        setPendingId(null);
      }
    },
    [addMember],
  );

  return (
    <div
      className="channel-members-overlay"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="channel-members-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Channel members"
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); }}
      >
        <header className="channel-members-header">
          <h3 className="channel-members-title">MEMBER ROSTER</h3>
          <button
            type="button"
            className="channel-members-close"
            onClick={onClose}
            aria-label="Close members panel"
          >
            [X]
          </button>
        </header>

        {error ? (
          <div className="channel-members-error" role="alert">
            {error.message}
          </div>
        ) : null}
        {addError ? (
          <div className="channel-members-error" role="alert">
            {addError}
          </div>
        ) : null}

        <section className="channel-members-section" aria-label="Current members">
          <div className="channel-members-rule">
            <span className="channel-members-rule-label">
              CURRENT // {members.length}
            </span>
          </div>
          {isLoading ? (
            <p className="channel-members-hint">LOADING ROSTER...</p>
          ) : members.length === 0 ? (
            <p className="channel-members-hint">NO MEMBERS</p>
          ) : (
            <ul className="channel-members-list">
              {members.map((m) => (
                <li key={m.memberId} className="channel-members-row">
                  <span className="channel-members-glyph" aria-hidden="true">
                    {m.memberKind === 'user' ? '@' : '>'}
                  </span>
                  <span className="channel-members-name">{m.memberId}</span>
                  <span
                    className={`channel-members-badge channel-members-badge-${m.role}`}
                  >
                    {m.role.toUpperCase()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="channel-members-section" aria-label="Add agent">
          <div className="channel-members-rule">
            <span className="channel-members-rule-label">ADD AGENT</span>
          </div>
          {!agentsLoaded ? (
            <p className="channel-members-hint">SCANNING CREW...</p>
          ) : addable.length === 0 ? (
            <p className="channel-members-hint">ALL AGENTS ARE MEMBERS</p>
          ) : (
            <ul className="channel-members-list">
              {addable.map((a) => (
                <li key={a.id} className="channel-members-add-row">
                  <button
                    type="button"
                    className="channel-members-add-btn"
                    onClick={() => void handleAdd(a.id)}
                    disabled={pendingId !== null}
                    aria-label={`Add ${a.name} to channel`}
                  >
                    <span className="channel-members-glyph" aria-hidden="true">
                      +
                    </span>
                    <span className="channel-members-name">{a.name}</span>
                    <span className="channel-members-add-cue">
                      {pendingId === a.id ? 'ADDING...' : 'ADD'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

export const ChannelMembersPanel = React.memo(ChannelMembersPanelImpl);

export default ChannelMembersPanel;
