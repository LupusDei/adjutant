/**
 * ChannelView (adj-164.5.3) — the multi-party room view.
 *
 * Reuses the DM transcript path verbatim: MessageBubble + react-virtuoso +
 * same-sender run grouping (adj-164.2.2). Because every message keeps its real
 * `agentId`/`role`, MessageBubble already renders per-sender attribution and the
 * grouping function already refuses to merge two different agents into one run —
 * so multi-party rendering is correct without any channel-specific bubble code.
 *
 * Real-time delivery + sending are owned by `useChannelMessages`.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';

import { MessageBubble } from './MessageBubble';
import { computeMessageGroups } from './messageGrouping';
import { useChannelMessages } from '../../hooks/useChannelMessages';
import type { DisplayMessage } from '../../hooks/useChatMessages';
import { getTimeFormatter, formatDateCached } from '../../utils/dateFormatter';
import './chat.css';

const TIME_FORMATTER = getTimeFormatter('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function formatTimestamp(timestamp: string): string {
  return formatDateCached(timestamp, TIME_FORMATTER);
}

export interface ChannelViewProps {
  /** The open channel's conversation id. */
  channelId: string;
  /** Display title for the room header. */
  title: string;
  /** Whether this view is active (gates voice/WS work in the parent). */
  isActive?: boolean;
}

// A no-op play handler: channels are text-first (voice is DM-only per spec
// scope). MessageBubble still requires the prop; a stable module-level ref
// keeps the bubble's memo equality intact.
const NOOP_PLAY = (_msg: DisplayMessage): void => {};

function ChannelViewImpl({ channelId, title }: ChannelViewProps) {
  const { messages, isLoading, error, hasMore, sendMessage, loadMore } = useChannelMessages(channelId);

  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const groupFlags = useMemo(() => computeMessageGroups(messages), [messages]);
  const groupFlagsRef = useRef(groupFlags);
  groupFlagsRef.current = groupFlags;

  const followOutput = useCallback(
    (isAtBottom: boolean): 'smooth' | false => (isAtBottom ? 'smooth' : false),
    [],
  );

  const handleStartReached = useCallback(() => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    void loadMore().finally(() => { setLoadingMore(false); });
  }, [hasMore, loadMore, loadingMore]);

  // Build the Virtuoso components object so `Header` is OMITTED (not set to
  // `undefined`) when there's nothing more to load — `exactOptionalPropertyTypes`
  // rejects an explicit `undefined`, and an empty object is the correct "no
  // header" signal.
  const virtuosoComponents = useMemo(
    () =>
      hasMore
        ? {
            Header: () => (
              <div className="chat-load-more">
                {loadingMore ? 'LOADING...' : 'SCROLL UP FOR MORE'}
              </div>
            ),
          }
        : {},
    [hasMore, loadingMore],
  );

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || sending) return;
    setInputValue('');
    setSendError(null);
    setSending(true);
    try {
      await sendMessage(text);
      inputRef.current?.focus();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send message');
      setInputValue(text);
    } finally {
      setSending(false);
    }
  }, [inputValue, sending, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  const renderMessage = useCallback((msg: DisplayMessage) => {
    const isUser = msg.role === 'user';
    const isSystem = msg.role === 'system' || msg.role === 'announcement';
    if (isSystem) {
      return (
        <div className="chat-system-message">
          <span className="chat-system-body">{msg.body}</span>
          <span className="chat-system-time">{formatTimestamp(msg.createdAt)}</span>
        </div>
      );
    }
    const flags = groupFlagsRef.current.get(msg.id);
    return (
      <MessageBubble
        msg={msg}
        isUser={isUser}
        isPlaying={false}
        isLoadingPlay={false}
        onPlay={NOOP_PLAY}
        formatTimestamp={formatTimestamp}
        showSender={flags?.isFirstInGroup ?? true}
        showTime={flags?.isLastInGroup ?? true}
      />
    );
  }, []);

  if (isLoading) {
    return (
      <div className="command-chat">
        <div className="chat-loading">
          <div className="chat-loading-spinner" />
          JOINING CHANNEL...
        </div>
      </div>
    );
  }

  const displayError = error?.message ?? sendError;

  return (
    <div className="command-chat">
      <header className="chat-header">
        <h2 className="chat-title"># {title.toUpperCase()}</h2>
        <div className="chat-header-right">
          <span className="chat-status">{messages.length} MESSAGES</span>
        </div>
      </header>

      {displayError && (
        <div className="chat-error" role="alert">
          {displayError}
          <button onClick={() => { setSendError(null); }} className="chat-error-dismiss">x</button>
        </div>
      )}

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p>NO MESSAGES YET</p>
            <p className="chat-empty-hint">Be the first to transmit in #{title}</p>
          </div>
        ) : (
          <Virtuoso
            data={messages}
            computeItemKey={(_index, msg) => msg.id}
            itemContent={(_index, msg) => renderMessage(msg)}
            followOutput={followOutput}
            {...(hasMore ? { startReached: handleStartReached } : {})}
            alignToBottom
            style={{ height: '100%' }}
            components={virtuosoComponents}
          />
        )}
      </div>

      <div className="chat-input-area">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => { setInputValue(e.target.value); }}
          onKeyDown={handleKeyDown}
          placeholder={`MESSAGE #${title.toUpperCase()}...`}
          className="chat-input"
          disabled={sending}
          autoFocus
        />
        <button
          onClick={() => void handleSend()}
          disabled={!inputValue.trim() || sending}
          className="chat-send-btn"
        >
          {sending ? '...' : 'SEND'}
        </button>
      </div>
    </div>
  );
}

export const ChannelView = React.memo(ChannelViewImpl);

export default ChannelView;
