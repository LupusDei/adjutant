/**
 * ChatView (adj-164.5.5) — the chat panel container.
 *
 * Hosts two surfaces behind a state-preserving mode switch:
 *  - DIRECT   → 1:1 DMs (ChatAgentSelector + CommandChat, scoped by agent).
 *  - CHANNELS → multi-party rooms (ChannelList + ChannelView, scoped by id).
 *
 * Selection state for each surface lives at this level and is never reset by a
 * mode switch, so the operator returns to exactly where they left off in either
 * surface. Only the *active* surface is mounted, so the inactive surface's data
 * hooks/WS subscriptions are torn down — channel real-time fan-out stops when
 * the operator is in DM mode and vice-versa.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';

import { CommandChat } from './CommandChat';
import { ChatAgentSelector } from './ChatAgentSelector';
import { ChannelList } from './ChannelList';
import { ChannelView } from './ChannelView';
import { useUnreadCounts } from '../../hooks/useUnreadCounts';
import { useChannels } from '../../hooks/useChannels';
import './chat.css';

export interface ChatViewProps {
  isActive?: boolean;
  initialAgent?: string;
  onInitialAgentConsumed?: () => void;
}

type ChatMode = 'dm' | 'channels';

export function ChatView({ isActive = true, initialAgent, onInitialAgentConsumed }: ChatViewProps) {
  const [mode, setMode] = useState<ChatMode>('dm');
  const [selectedAgent, setSelectedAgent] = useState('');
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

  const { counts } = useUnreadCounts();
  const { channels, unread, createChannel } = useChannels();

  // Deep-link from a crew-card tap forces DM mode on that agent. This also
  // means an external navigation never silently lands the operator in the
  // wrong surface.
  useEffect(() => {
    if (initialAgent && initialAgent.length > 0) {
      setMode('dm');
      setSelectedAgent(initialAgent);
      onInitialAgentConsumed?.();
    }
  }, [initialAgent, onInitialAgentConsumed]);

  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === selectedChannelId) ?? null,
    [channels, selectedChannelId],
  );

  const handleCreateChannel = useCallback(
    (title: string) => {
      void createChannel(title)
        .then((created) => { setSelectedChannelId(created.id); })
        .catch(() => { /* surfaced by the hook's error state on next render */ });
    },
    [createChannel],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Mode switch — segmented control, Pip-Boy themed. */}
      <div className="chat-mode-switch" role="tablist" aria-label="Chat mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'dm'}
          className={`chat-mode-tab${mode === 'dm' ? ' chat-mode-tab-active' : ''}`}
          onClick={() => { setMode('dm'); }}
        >
          DIRECT
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'channels'}
          className={`chat-mode-tab${mode === 'channels' ? ' chat-mode-tab-active' : ''}`}
          onClick={() => { setMode('channels'); }}
        >
          CHANNELS
        </button>
      </div>

      {mode === 'dm' ? (
        <>
          <div className="chat-agent-selector-bar">
            <ChatAgentSelector
              value={selectedAgent}
              onChange={setSelectedAgent}
              unreadCounts={counts}
            />
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <CommandChat
              isActive={isActive}
              {...(selectedAgent ? { agentId: selectedAgent } : {})}
            />
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: '220px', flexShrink: 0, minHeight: 0 }}>
            <ChannelList
              channels={channels}
              unread={unread}
              selectedId={selectedChannelId}
              onSelect={setSelectedChannelId}
              onCreate={handleCreateChannel}
            />
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {selectedChannel ? (
              <ChannelView
                channelId={selectedChannel.id}
                title={selectedChannel.title ?? selectedChannel.id}
                isActive={isActive}
              />
            ) : (
              <div className="command-chat">
                <div className="chat-empty">
                  <p>SELECT A CHANNEL</p>
                  <p className="chat-empty-hint">Pick a room from the list, or create one</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ChatView;
