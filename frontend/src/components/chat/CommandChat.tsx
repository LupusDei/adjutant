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
import type { ConnectionStatus, ChatMessage } from '../../types';
import { useChatMessages, type DisplayMessage } from '../../hooks/useChatMessages';
import { api } from '../../services/api';
import { useUnreadCounts } from '../../hooks/useUnreadCounts';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useVoicePlayer } from '../../hooks/useVoicePlayer';
import { useMode } from '../../contexts/ModeContext';
import { useCommunication } from '../../contexts/CommunicationContext';
import { useChatWebSocket } from '../../hooks/useChatWebSocket';
import type { WsChatMessage, WsDeliveryConfirmation, WsStreamToken, WsTypingIndicator, ChatWebSocketCallbacks } from '../../hooks/useChatWebSocket';
import './chat.css';

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
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (diffDays === 0) {
    return timeStr;
  } else if (diffDays === 1) {
    return `Yesterday ${timeStr}`;
  } else if (diffDays < 7) {
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
    return `${dayName} ${timeStr}`;
  } else {
    const dateStr = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
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
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Get deployment mode for UI labels
  const { isGasTown } = useMode();
  const { priority, connectionStatus: commContextStatus } = useCommunication();

  // Persistent messages from SQLite store
  const {
    messages,
    isLoading,
    error: fetchError,
    hasMore,
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

  // Determine coordinator name based on mode and agentId
  const coordinatorName = agentId
    ? agentId.toUpperCase()
    : (isGasTown ? 'MAYOR' : 'SWARM');
  const coordinatorAddress = agentId
    ? agentId
    : (isGasTown ? 'mayor/' : 'user');

  // Voice input hook for recording
  const voiceInput = useVoiceInput();

  // Voice player hook for playback
  const voicePlayer = useVoicePlayer();

  // Whether to use WebSocket (only when priority is real-time)
  const wsEnabled = isActive && priority === 'real-time';

  // WebSocket callbacks (stable refs via useMemo)
  const wsCallbacks: ChatWebSocketCallbacks = useMemo(() => ({
    onMessage: (_msg: WsChatMessage) => {
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
        typingTimer.current = setTimeout(() => setTypingFrom(null), 5000);
      } else {
        setTypingFrom(null);
        if (typingTimer.current) {
          clearTimeout(typingTimer.current);
          typingTimer.current = null;
        }
      }
    },
  }), [confirmDelivery]);

  // WebSocket connection for streaming and typing
  const { connected: wsConnected, connectionStatus: wsConnectionStatus, sendTyping } = useChatWebSocket(wsEnabled, wsCallbacks);

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

  // Scroll to bottom when messages change
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Scroll to bottom when messages or streaming update
  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingMessages, scrollToBottom]);

  // Cleanup typing timer
  useEffect(() => {
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, []);

  // IntersectionObserver for infinite scroll — loads older messages when sentinel is visible
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingMore) {
          setLoadingMore(true);
          void loadMore().finally(() => setLoadingMore(false));
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
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

  // Handle playing a message
  const handlePlayMessage = async (msg: DisplayMessage) => {
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
  };

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
          onChange={(e) => setSearchQuery(e.target.value)}
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
          <button onClick={() => setSendError(null)} className="chat-error-dismiss">
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
                      {isUser ? 'YOU' : (msg.agentId ?? coordinatorName).toUpperCase()}
                    </span>
                  </div>
                  <div className="chat-bubble-content">{msg.body}</div>
                  <div className="chat-bubble-time">{formatTimestamp(msg.createdAt)}</div>
                </div>
              );
            })
          )
        ) : (
        <>
        {/* Infinite scroll sentinel for loading older messages */}
        {hasMore && (
          <div ref={loadMoreSentinelRef} className="chat-load-more">
            {loadingMore ? 'LOADING...' : 'SCROLL UP FOR MORE'}
          </div>
        )}

        {messages.length === 0 ? (
          <div className="chat-empty">
            <p>NO MESSAGES YET</p>
            <p className="chat-empty-hint">
              {agentId
                ? `Send a message to ${coordinatorName} below`
                : `Send a message to ${coordinatorName} below`}
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = isUserMessage(msg);
            const isPlayingThis = playingMessageId === msg.id;
            const isLoadingThis = isPlayingThis && voicePlayer.isLoading;
            const isSending = msg.optimisticStatus === 'sending';
            const isDelivered = msg.optimisticStatus === 'delivered';
            const isFailed = msg.optimisticStatus === 'failed';
            return (
              <div
                key={msg.id}
                className={`chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-command'} ${isSending ? 'chat-bubble-sending' : ''} ${isFailed ? 'chat-bubble-failed' : ''}`}
              >
                <div className="chat-bubble-header">
                  <span className="chat-bubble-sender">
                    {isUser ? 'YOU' : (msg.agentId ?? coordinatorName).toUpperCase()}
                  </span>
                  <button
                    type="button"
                    className={`chat-play-btn ${isPlayingThis ? 'chat-play-btn-active' : ''}`}
                    onClick={() => void handlePlayMessage(msg)}
                    disabled={isLoadingThis}
                    aria-label={isPlayingThis ? 'Stop' : 'Play message'}
                    title={isPlayingThis ? 'Stop' : 'Play message'}
                  >
                    {isLoadingThis ? '?' : isPlayingThis ? '||' : '>'}
                  </button>
                </div>
                <div className="chat-bubble-content">
                  {msg.body}
                </div>
                <div className="chat-bubble-time">
                  {isSending && (
                    <span className="chat-delivery-status">SENDING </span>
                  )}
                  {isDelivered && msg.clientId && (
                    <span className="chat-delivery-status chat-delivery-confirmed">DELIVERED </span>
                  )}
                  {isFailed && (
                    <span className="chat-delivery-status chat-delivery-failed">FAILED </span>
                  )}
                  {formatTimestamp(msg.createdAt)}
                </div>
              </div>
            );
          })
        )}

        {/* Streaming messages */}
        {streamingEntries.map(([streamId, body]) => (
          <div key={`stream-${streamId}`} className="chat-bubble chat-bubble-command chat-bubble-streaming">
            <div className="chat-bubble-header">
              <span className="chat-bubble-sender">{coordinatorName}</span>
              <span className="chat-streaming-indicator">STREAMING</span>
            </div>
            <div className="chat-bubble-content">
              {body}<span className="chat-cursor">_</span>
            </div>
          </div>
        ))}

        {/* Typing indicator */}
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
