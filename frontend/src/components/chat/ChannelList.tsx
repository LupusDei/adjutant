/**
 * ChannelList (adj-164.5.2) — the channel sidebar for the chat panel.
 *
 * Presentational: the roster + unread map come from `useChannels`; selection
 * and creation flow back out via callbacks. Styled to the Pip-Boy CRT theme
 * (monochrome green phosphor, monospace, `>` row markers) reusing the chat.css
 * CSS variables so it sits seamlessly beside CommandChat.
 */
import React, { useCallback, useState } from 'react';

import type { ChannelSummary } from '../../types';
import './chat.css';

export interface ChannelListProps {
  /** All channels, in display order. */
  channels: ChannelSummary[];
  /** Per-channel unread counts keyed by channel id. Missing key ⇒ 0. */
  unread: Record<string, number>;
  /** The currently open channel id, or null when none is selected. */
  selectedId: string | null;
  /** Called with the channel id when a row is activated. */
  onSelect: (channelId: string) => void;
  /** Called with a trimmed, non-empty name when the create form is submitted. */
  onCreate: (title: string) => void;
}

function ChannelListImpl({ channels, unread, selectedId, onSelect, onCreate }: ChannelListProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = name.trim();
      if (trimmed.length === 0) return;
      onCreate(trimmed);
      setName('');
      setCreating(false);
    },
    [name, onCreate],
  );

  return (
    <nav className="channel-list" aria-label="Channels">
      <div className="channel-list-head">
        <span className="channel-list-title">CHANNELS</span>
        <span className="channel-list-count">{channels.length}</span>
      </div>

      <div className="channel-list-scroll">
        {channels.length === 0 ? (
          <div className="channel-list-empty">
            <p>NO CHANNELS</p>
            <p className="channel-list-empty-hint">Create one to start a room</p>
          </div>
        ) : (
          <ul className="channel-list-items">
            {channels.map((c) => {
              const count = unread[c.id] ?? 0;
              const isActive = c.id === selectedId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    data-testid={`channel-row-${c.id}`}
                    className={`channel-row${isActive ? ' channel-row-active' : ''}${count > 0 ? ' channel-row-unread' : ''}`}
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => { onSelect(c.id); }}
                  >
                    <span className="channel-row-marker" aria-hidden="true">
                      {isActive ? '>' : '#'}
                    </span>
                    <span className="channel-row-name">{c.title ?? c.id}</span>
                    <span className="channel-row-members" title={`${String(c.memberCount)} members`}>
                      {c.memberCount}
                    </span>
                    {count > 0 && (
                      <span className="channel-row-badge" data-testid={`channel-unread-${c.id}`}>
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="channel-list-foot">
        {creating ? (
          <form className="channel-create-form" onSubmit={handleSubmit}>
            <span className="channel-create-prompt" aria-hidden="true">&gt;</span>
            <input
              type="text"
              className="channel-create-input"
              value={name}
              onChange={(e) => { setName(e.target.value); }}
              placeholder="CHANNEL NAME..."
              aria-label="New channel name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setCreating(false);
                  setName('');
                }
              }}
            />
            <button type="submit" className="channel-create-confirm" aria-label="Create channel">
              OK
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="channel-create-btn"
            onClick={() => { setCreating(true); }}
          >
            + NEW CHANNEL
          </button>
        )}
      </div>
    </nav>
  );
}

export const ChannelList = React.memo(ChannelListImpl);

export default ChannelList;
