/**
 * CommandChat Component - SMS-style conversation with agents
 * Works in both Gas Town (Mayor) and Swarm modes
 *
 * Uses useChatMessages for persistent SQLite-backed messages via /api/messages.
 * WebSocket for real-time delivery, streaming responses, and typing indicators.
 * Features: optimistic send, delivery confirmation, agent-scoped conversations,
 * connection status indicator, voice input/playback.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';

import { MarkdownBody } from './MarkdownBody';
import { MessageBubble } from './MessageBubble';
import { computeMessageGroups } from './messageGrouping';
import { messageRowClass } from './messageRow';
import type { ConnectionStatus, ChatMessage } from '../../types';
import { useChatMessages, type DisplayMessage } from '../../hooks/useChatMessages';
import { api } from '../../services/api';
import { useUnreadCounts } from '../../hooks/useUnreadCounts';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useVoicePlayer } from '../../hooks/useVoicePlayer';
import { useCommunication } from '../../contexts/CommunicationContext';
import { useChatWebSocket } from '../../hooks/useChatWebSocket';
import type { WsDeliveryConfirmation, WsStreamToken, WsTypingIndicator, ChatWebSocketCallbacks } from '../../hooks/useChatWebSocket';
import { getTimeFormatter, formatDateCached } from '../../utils/dateFormatter';
import './chat.css';

// ============================================================================
// Module-level formatters
// ============================================================================
//
// Hoisted out of `formatTimestamp` so we construct each Intl.DateTimeFormat
// exactly once per process — not once per message render. Previously,
// `date.toLocaleTimeString(locale, options)` allocated a fresh formatter
// internally on every call, which was the single biggest CPU cost in chat
// scroll-back (>10ms per message in dev mode).

const TIME_FORMATTER = getTimeFormatter('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const WEEKDAY_FORMATTER = getTimeFormatter('en-US', {
  weekday: 'short',
});

const MONTH_DAY_FORMATTER = getTimeFormatter('en-US', {
  month: 'short',
  day: 'numeric',
});

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export interface CommandChatProps {
  /** Whether this tab is currently active */
  isActive?: boolean;
  /** Agent ID to scope the conversation. Undefined shows coordinator messages. */
  agentId?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if message is from the user.
 */
function isUserMessage(msg: DisplayMessage): boolean {
  return msg.role === 'user';
}

/**
 * Format timestamp for chat display.
 *
 * Uses module-level singleton Intl.DateTimeFormat instances and an LRU
 * cache keyed by ISO timestamp string, avoiding both formatter
 * construction and Date parsing on cache hits. A 10k-message scroll-back
 * formats in <5ms with this path (vs >500ms with per-call allocation).
 */
function formatTimestamp(timestamp: string): string {
  const timeStr = formatDateCached(timestamp, TIME_FORMATTER);

  // Day delta — still requires parsing the date for the comparison, but
  // this is a single Date allocation per format and cannot be cached
  // without invalidating across day boundaries.
  const dateMs = new Date(timestamp).getTime();
  const diffMs = Date.now() - dateMs;
  const diffDays = Math.floor(diffMs / MS_PER_DAY);

  if (diffDays === 0) {
    return timeStr;
  } else if (diffDays === 1) {
    return `Yesterday ${timeStr}`;
  } else if (diffDays < 7) {
    const dayName = formatDateCached(timestamp, WEEKDAY_FORMATTER);
    return `${dayName} ${timeStr}`;
  } else {
    const dateStr = formatDateCached(timestamp, MONTH_DAY_FORMATTER);
    return `${dateStr} ${timeStr}`;
  }
}

/**
 * Get display label for connection status.
 */
function getStatusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'websocket': return 'WS';
    case 'sse': return 'SSE';
    case 'polling': return 'HTTP';
    case 'reconnecting': return 'RECONNECTING';
    case 'disconnected': return 'OFFLINE';
  }
}

/**
 * Get CSS class for connection status indicator.
 */
function getStatusClass(status: ConnectionStatus): string {
  switch (status) {
    case 'websocket': return 'comm-indicator-ws';
    case 'sse': return 'comm-indicator-sse';
    case 'polling': return 'comm-indicator-polling';
    case 'reconnecting': return 'comm-indicator-reconnecting';
    case 'disconnected': return 'comm-indicator-disconnected';
  }
}

// ============================================================================
// Component
// ============================================================================

/**
 * CommandChat - SMS-style conversation interface.
 * Adapts to deployment mode (Gas Town: Mayor, Swarm: Agent).
 *
 * Data source: /api/messages (SQLite-backed persistent store)
 * Real-time: WebSocket for messages, streaming, typing indicators
 */
export const CommandChat: React.FC<CommandChatProps> = ({ isActive = true, agentId }) => {
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [typingFrom, setTypingFrom] = useState<string | null>(null);
  const [streamingMessages, setStreamingMessages] = useState<Map<string, string>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatMessage[] | null>(null);
  const [searching, setSearching] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const { priority, connectionStatus: commContextStatus } = useCommunication();

  // Persistent messages from SQLite store
  const {
    messages,
    isLoading,
    error: fetchError,
    hasMore,
    conversationId,
    sendMessage: hookSendMessage,
    confirmDelivery,
    loadMore,
  } = useChatMessages(agentId);

  // Unread counts - mark conversation as read when opened
  const { markRead } = useUnreadCounts();

  useEffect(() => {
    if (agentId && isActive) {
      void markRead(agentId);
    }
  }, [agentId, isActive, markRead]);

  // Display label for the open conversation. With no explicit agent selected
  // the default view is the coordinator DM (adj-ropat) — label it COORDINATOR
  // rather than the old "AGENTS", which named a now-dead aggregate surface.
  const coordinatorName = agentId
    ? agentId.toUpperCase()
    : 'COORDINATOR';
  // Voice input hook for recording
  const voiceInput = useVoiceInput();

  // Voice player hook for playback
  const voicePlayer = useVoicePlayer();

  // Whether to use WebSocket (only when priority is real-time)
  const wsEnabled = isActive && priority === 'real-time';

  // WebSocket callbacks (stable refs via useMemo)
  const wsCallbacks: ChatWebSocketCallbacks = useMemo(() => ({
    onMessage: () => {
      // Messages from WebSocket are now handled by useChatMessages
      // via the CommunicationContext subscription. No-op here to avoid duplicates.
    },

    onDelivery: (confirmation: WsDeliveryConfirmation) => {
      confirmDelivery(confirmation.clientId, confirmation.messageId);
    },

    onStreamToken: (token: WsStreamToken) => {
      setStreamingMessages((prev) => {
        const next = new Map(prev);
        next.set(token.streamId, (prev.get(token.streamId) ?? '') + token.token);
        return next;
      });
    },

    onStreamEnd: (streamId: string, messageId?: string) => {
      setStreamingMessages((prev) => {
        const body = prev.get(streamId);
        const next = new Map(prev);
        next.delete(streamId);

        // Convert completed stream to a message via the hook's real-time subscription
        // The final message will arrive via WebSocket/CommunicationContext
        // If it doesn't arrive within a brief window, we could trigger a refetch,
        // but typically the backend sends the finalized message as a chat_message event.
        if (body && !messageId) {
          // Stream completed without a final message ID — body was ephemeral
          // This is fine; the final message will come through as a regular message event
        }

        return next;
      });
    },

    onTyping: (indicator: WsTypingIndicator) => {
      if (indicator.state === 'started' || indicator.state === 'thinking') {
        setTypingFrom(indicator.from);
        // Clear typing after 5s if no update
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => { setTypingFrom(null); }, 5000);
      } else {
        setTypingFrom(null);
        if (typingTimer.current) {
          clearTimeout(typingTimer.current);
          typingTimer.current = null;
        }
      }
    },
  }), [confirmDelivery]);

  // WebSocket connection for streaming and typing. The resolved conversation
  // id scopes real-time chat_message delivery to the open DM (adj-164.2.4).
  const { connected: wsConnected, connectionStatus: wsConnectionStatus, sendTyping } = useChatWebSocket(
    wsEnabled,
    wsCallbacks,
    conversationId ?? undefined,
  );

  // Effective connection status: WS status when enabled, otherwise from context
  const effectiveStatus: ConnectionStatus = wsEnabled ? wsConnectionStatus : commContextStatus;

  // Handle transcript from voice input
  useEffect(() => {
    if (voiceInput.transcript) {
      setInputValue((prev) => prev + (prev ? ' ' : '') + voiceInput.transcript);
      voiceInput.clearTranscript();
      inputRef.current?.focus();
    }
  }, [voiceInput.transcript, voiceInput.clearTranscript]);

  // followOutput is the auto-scroll-only-when-at-bottom policy for the
  // virtualized timeline (adj-164.2.2): Virtuoso calls it with the live
  // at-bottom state on every new item. Returning false when the user has
  // scrolled up to read history suppresses the scroll-jump; returning 'smooth'
  // keeps them pinned to the newest message when they're already at the bottom.
  const followOutput = useCallback(
    (isAtBottom: boolean): 'smooth' | false => (isAtBottom ? 'smooth' : false),
    [],
  );

  // Scroll to bottom when messages change. This drives the non-virtualized
  // empty/streaming-footer path (`messagesEndRef`). The virtualized message
  // list's "only scroll when at bottom" behavior is owned by `followOutput`
  // above — that callback is evaluated by Virtuoso against real layout, where
  // at-bottom detection is reliable (jsdom has no layout, so duplicating the
  // guard here would suppress legitimate scrolls in tests and on first paint).
  //
  // Wrapped in requestAnimationFrame so bursts (e.g. a rapid streaming
  // token sequence that grows the message list by one per ~50ms) collapse
  // into one scrollIntoView call per paint instead of one per state flip.
  const scrollRafRef = useRef<number | null>(null);
  const scrollToBottom = useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
  }, []);

  // Scroll to bottom only when the message count or streaming count
  // actually changes — NOT on every render. Reference deps were the bug:
  // `streamingMessages` is a Map created fresh by `new Map(prev)` in each
  // onStreamToken handler, so the effect refired on every token even when
  // the visible state was identical, defeating React batching.
  useEffect(() => {
    scrollToBottom();
  }, [messages.length, streamingMessages.size, scrollToBottom]);

  // Cancel any pending RAF on unmount to prevent leaks.
  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  // Cleanup typing timer
  useEffect(() => {
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, []);

  // adj-139.4.2: Virtuoso's startReached drives load-more when the user
  // scrolls to the top. Replaces the IntersectionObserver-on-sentinel
  // pattern from the pre-virtualized version.
  const handleStartReached = useCallback(() => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    void loadMore().finally(() => { setLoadingMore(false); });
  }, [hasMore, loadMore, loadingMore]);


  // Handle sending a message — always via HTTP (hookSendMessage).
  // The backend stores the message and broadcasts it via WebSocket.
  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || sending) return;

    setInputValue('');
    setSendError(null);
    setSending(true);

    try {
      await hookSendMessage(text);
      inputRef.current?.focus();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send message');
      setInputValue(text); // Restore input on error
    } finally {
      setSending(false);
    }
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // Handle search
  const handleSearch = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults(null);
      return;
    }

    setSearching(true);
    try {
      const params: Parameters<typeof api.messages.search>[0] = { q: trimmed };
      if (agentId) params.agentId = agentId;
      const result = await api.messages.search(params);
      setSearchResults(result.items);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [agentId]);

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSearch(searchQuery);
    } else if (e.key === 'Escape') {
      setSearchQuery('');
      setSearchResults(null);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults(null);
  };

  // Handle input change with typing indicator
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    if (wsConnected && e.target.value.length > 0) {
      sendTyping('started');
    }
  };

  // Handle voice recording
  const handleMicClick = async () => {
    if (voiceInput.isRecording) {
      voiceInput.stopRecording();
    } else {
      await voiceInput.startRecording();
    }
  };

  // Handle playing a message.
  //
  // Wrapped in useCallback so MessageBubble's memo equality can hold —
  // an unstable callback would force every bubble to re-render on every
  // parent state flip.
  const handlePlayMessage = useCallback(async (msg: DisplayMessage) => {
    if (voicePlayer.isPlaying && playingMessageId === msg.id) {
      voicePlayer.stop();
      setPlayingMessageId(null);
    } else {
      setPlayingMessageId(msg.id);
      try {
        await voicePlayer.play(msg.body);
      } finally {
        setPlayingMessageId(null);
      }
    }
  }, [voicePlayer, playingMessageId]);

  // Bridge to MessageBubble's onPlay (synchronous wrapper — the bubble
  // doesn't await; React fires-and-forgets the async play.).
  const onPlayMessage = useCallback((msg: DisplayMessage) => {
    void handlePlayMessage(msg);
  }, [handlePlayMessage]);

  // adj-164.2.2: same-sender run grouping. Computed once per message list
  // (O(n)) and read inside renderMessage via a ref so the Virtuoso render
  // callback stays referentially stable across parent re-renders.
  const groupFlags = useMemo(() => computeMessageGroups(messages), [messages]);
  const groupFlagsRef = useRef(groupFlags);
  groupFlagsRef.current = groupFlags;

  // adj-139.4.2: Render callback for Virtuoso. Returns the bubble/system
  // message DOM for a single message. Kept stable via useCallback so that
  // Virtuoso's internal memoization isn't invalidated on parent re-renders.
  const renderMessage = useCallback((msg: DisplayMessage) => {
    const isUser = isUserMessage(msg);
    const isSystem = msg.role === 'system' || msg.role === 'announcement';

    // Each item is wrapped in a flex-column alignment row so the bubble's
    // alignment resolves inside react-virtuoso's (non-flex) item wrapper
    // (adj-mw7lc). Without this, user + agent bubbles both render left-aligned.
    if (isSystem) {
      return (
        <div className={messageRowClass(msg)}>
          <div className="chat-system-message">
            <span className="chat-system-body">{msg.body}</span>
            <span className="chat-system-time">{formatTimestamp(msg.createdAt)}</span>
          </div>
        </div>
      );
    }

    const flags = groupFlagsRef.current.get(msg.id);
    const showSender = flags?.isFirstInGroup ?? true;
    const showTime = flags?.isLastInGroup ?? true;

    const isPlayingThis = playingMessageId === msg.id;
    const isLoadingThis = isPlayingThis && voicePlayer.isLoading;
    return (
      <div className={messageRowClass(msg)}>
        <MessageBubble
          msg={msg}
          isUser={isUser}
          isPlaying={isPlayingThis}
          isLoadingPlay={isLoadingThis}
          onPlay={onPlayMessage}
          formatTimestamp={formatTimestamp}
          showSender={showSender}
          showTime={showTime}
        />
      </div>
    );
  }, [playingMessageId, voicePlayer.isLoading, onPlayMessage]);

  // Track when voice player stops
  useEffect(() => {
    if (!voicePlayer.isPlaying && !voicePlayer.isLoading) {
      setPlayingMessageId(null);
    }
  }, [voicePlayer.isPlaying, voicePlayer.isLoading]);

  if (isLoading) {
    return (
      <div className="command-chat">
        <div className="chat-loading">
          <div className="chat-loading-spinner" />
          ESTABLISHING SECURE CHANNEL...
        </div>
      </div>
    );
  }

  // Convert streaming messages to displayable entries
  const streamingEntries = Array.from(streamingMessages.entries());
  const displayError = fetchError?.message ?? sendError;

  return (
    <div className="command-chat">
      {/* Header */}
      <header className="chat-header">
        <h2 className="chat-title">{coordinatorName} DIRECT LINE</h2>
        <div className="chat-header-right">
          <span className={`comm-indicator ${getStatusClass(effectiveStatus)}`}>
            {getStatusLabel(effectiveStatus)}
          </span>
          <span className="chat-status">
            {messages.length} MESSAGES
          </span>
        </div>
      </header>

      {/* Search bar */}
      <div className="chat-search-bar">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); }}
          onKeyDown={handleSearchKeyDown}
          placeholder="SEARCH MESSAGES..."
          className="chat-search-input"
        />
        {searchQuery && (
          <button
            type="button"
            className="chat-search-clear"
            onClick={clearSearch}
            aria-label="Clear search"
          >
            x
          </button>
        )}
        {searching && <span className="chat-search-status">SEARCHING...</span>}
      </div>

      {/* Error banner */}
      {displayError && (
        <div className="chat-error" role="alert">
          {displayError}
          <button onClick={() => { setSendError(null); }} className="chat-error-dismiss">
            x
          </button>
        </div>
      )}

      {/* Messages container */}
      <div className="chat-messages">
        {/* Search results overlay */}
        {searchResults !== null ? (
          searchResults.length === 0 ? (
            <div className="chat-empty">
              <p>NO RESULTS FOUND</p>
              <p className="chat-empty-hint">Try a different search term</p>
            </div>
          ) : (
            searchResults.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  className={`chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-command'}`}
                >
                  <div className="chat-bubble-header">
                    <span className="chat-bubble-sender">
                      {isUser ? 'YOU' : msg.agentId.toUpperCase()}
                    </span>
                  </div>
                  <div className="chat-bubble-content"><MarkdownBody>{msg.body}</MarkdownBody></div>
                  <div className="chat-bubble-time">{formatTimestamp(msg.createdAt)}</div>
                </div>
              );
            })
          )
        ) : messages.length === 0 ? (
          <>
            <div className="chat-empty">
              <p>NO MESSAGES YET</p>
              <p className="chat-empty-hint">
                {`Send a message to ${coordinatorName} below`}
              </p>
            </div>
            {/* Streaming messages (rendered outside virtuoso when message list empty) */}
            {streamingEntries.map(([streamId, body]) => (
              <div key={`stream-${streamId}`} className="chat-bubble chat-bubble-command chat-bubble-streaming">
                <div className="chat-bubble-header">
                  <span className="chat-bubble-sender">{coordinatorName}</span>
                  <span className="chat-streaming-indicator">STREAMING</span>
                </div>
                <div className="chat-bubble-content">
                  <MarkdownBody>{body}</MarkdownBody><span className="chat-cursor">_</span>
                </div>
              </div>
            ))}
            {typingFrom && streamingEntries.length === 0 && (
              <div className="chat-typing-indicator">
                <span className="chat-typing-dots">
                  <span>.</span><span>.</span><span>.</span>
                </span>
                {' '}{coordinatorName} is typing
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={messages}
            // Stable, no-key prop here — Virtuoso uses the index. We use msg.id
            // inside itemContent for child stability.
            computeItemKey={(_index, msg) => msg.id}
            itemContent={(_index, msg) => renderMessage(msg)}
            followOutput={followOutput}
            startReached={hasMore ? handleStartReached : undefined}
            alignToBottom
            style={{ height: '100%' }}
            components={{
              Header: hasMore
                ? () => (
                    <div ref={loadMoreSentinelRef} className="chat-load-more">
                      {loadingMore ? 'LOADING...' : 'SCROLL UP FOR MORE'}
                    </div>
                  )
                : undefined,
              Footer: () => (
                <>
                  {streamingEntries.map(([streamId, body]) => (
                    // Footer renders inside Virtuoso's (non-flex) wrapper, so the
                    // streaming bubble needs the same agent alignment row as the
                    // virtualized items (adj-mw7lc).
                    <div key={`stream-${streamId}`} className="chat-msg-row chat-msg-row-agent">
                      <div className="chat-bubble chat-bubble-command chat-bubble-streaming">
                        <div className="chat-bubble-header">
                          <span className="chat-bubble-sender">{coordinatorName}</span>
                          <span className="chat-streaming-indicator">STREAMING</span>
                        </div>
                        <div className="chat-bubble-content">
                          <MarkdownBody>{body}</MarkdownBody><span className="chat-cursor">_</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {typingFrom && streamingEntries.length === 0 && (
                    <div className="chat-typing-indicator">
                      <span className="chat-typing-dots">
                        <span>.</span><span>.</span><span>.</span>
                      </span>
                      {' '}{coordinatorName} is typing
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </>
              ),
            }}
          />
        )}
      </div>

      {/* Input area */}
      <div className="chat-input-area">
        <button
          type="button"
          onClick={() => void handleMicClick()}
          disabled={sending || voiceInput.isProcessing}
          className={`chat-mic-btn ${voiceInput.isRecording ? 'chat-mic-btn-recording' : ''}`}
          aria-label={voiceInput.isRecording ? 'Stop recording' : 'Start recording'}
          title={voiceInput.isRecording ? 'Stop recording' : 'Record voice message'}
        >
          {voiceInput.isProcessing ? '?' : voiceInput.isRecording ? '||' : 'MIC'}
        </button>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={voiceInput.isRecording ? 'RECORDING...' : 'TYPE OR RECORD MESSAGE...'}
          className="chat-input"
          disabled={sending || voiceInput.isRecording}
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
      {voiceInput.error && (
        <div className="chat-voice-error">{voiceInput.error}</div>
      )}
    </div>
  );
};

export default CommandChat;

// Re-export as MayorChat for backward compatibility
export { CommandChat as MayorChat };
