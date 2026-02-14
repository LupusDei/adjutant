/**
 * CommandChat Component - SMS-style conversation with the coordinator
 * Works in both Gas Town (Mayor) and standalone (User) modes
 * Part of 005-overseer-views feature
 *
 * Uses WebSocket for real-time messaging when available, falls back to HTTP polling.
 * Features: optimistic send, delivery confirmation, streaming responses,
 * connection status indicator.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api } from '../../services/api';
import type { Message, SendMessageRequest, ConnectionStatus } from '../../types';
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
}

// ============================================================================
// Types
// ============================================================================

/** Extended message with delivery status for optimistic UI */
interface ChatMessage extends Message {
  /** Delivery status for optimistic UI */
  deliveryStatus?: 'sending' | 'delivered' | 'failed' | undefined;
  /** Client-side ID for matching delivery confirmations */
  clientId?: string | undefined;
  /** Whether this message is currently streaming */
  streaming?: boolean | undefined;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if a message is part of a command/coordinator conversation.
 */
function isCommandMessage(msg: Message): boolean {
  const fromLower = msg.from.toLowerCase();
  const toLower = msg.to.toLowerCase();
  return (
    fromLower.includes('mayor') ||
    toLower.includes('mayor') ||
    fromLower.includes('overseer') ||
    toLower.includes('overseer') ||
    fromLower === 'user' ||
    toLower === 'user'
  );
}

/**
 * Check if message is from the user (overseer side).
 */
function isUserMessage(msg: ChatMessage): boolean {
  const fromLower = msg.from.toLowerCase();
  return fromLower.includes('overseer') || fromLower === 'user';
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
 * CommandChat - SMS-style conversation interface with the coordinator.
 * Adapts to deployment mode (Gas Town: Mayor, Standalone: User).
 */
export const CommandChat: React.FC<CommandChatProps> = ({ isActive = true }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [typingFrom, setTypingFrom] = useState<string | null>(null);
  const [streamingMessages, setStreamingMessages] = useState<Map<string, string>>(new Map());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Get deployment mode for UI labels and recipient adaptation
  const { isGasTown, isSwarm } = useMode();
  const { priority, connectionStatus: commContextStatus } = useCommunication();

  // Determine coordinator name and address based on mode
  const coordinatorName = isGasTown ? 'MAYOR' : isSwarm ? 'SWARM' : 'COMMAND';
  const coordinatorAddress = isGasTown ? 'mayor/' : 'user';

  // Voice input hook for recording
  const voiceInput = useVoiceInput();

  // Voice player hook for playback
  const voicePlayer = useVoicePlayer();

  // Whether to use WebSocket (only when priority is real-time)
  const wsEnabled = isActive && priority === 'real-time';

  // WebSocket callbacks (stable refs via useMemo)
  const wsCallbacks: ChatWebSocketCallbacks = useMemo(() => ({
    onMessage: (msg: WsChatMessage) => {
      setMessages((prev) => {
        // Avoid duplicates (message might already exist from optimistic add or HTTP fetch)
        if (prev.some((m) => m.id === msg.id)) return prev;

        const newMsg: ChatMessage = {
          id: msg.id,
          from: msg.from,
          to: msg.to,
          subject: msg.body.slice(0, 50),
          body: msg.body,
          timestamp: msg.timestamp,
          read: false,
          priority: 2,
          type: 'reply',
          threadId: '',
          pinned: false,
          ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
        };

        // Only add if it's a command message
        if (!isCommandMessage(newMsg)) return prev;

        return [...prev, newMsg];
      });
    },

    onDelivery: (confirmation: WsDeliveryConfirmation) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.clientId === confirmation.clientId
            ? { ...m, id: confirmation.messageId, deliveryStatus: 'delivered' as const }
            : m,
        ),
      );
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

        // Convert completed stream to a regular message
        if (body) {
          const finalMsg: ChatMessage = {
            id: messageId ?? streamId,
            from: coordinatorAddress === 'mayor/' ? 'mayor/' : 'agent',
            to: 'overseer',
            subject: body.slice(0, 50),
            body,
            timestamp: new Date().toISOString(),
            read: false,
            priority: 2,
            type: 'reply',
            threadId: '',
            pinned: false,
          };
          setMessages((msgs) => [...msgs, finalMsg]);
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
  }), [coordinatorAddress]);

  // WebSocket connection
  const { connected: wsConnected, connectionStatus: wsConnectionStatus, sendMessage: wsSendMessage, sendTyping } = useChatWebSocket(wsEnabled, wsCallbacks);

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

  // Fetch command-related messages via HTTP
  const fetchMessages = useCallback(async () => {
    try {
      const response = await api.mail.list({ all: true });
      const commandMessages = response.items
        .filter(isCommandMessage)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      setMessages((prev) => {
        // Merge: keep optimistic messages that haven't been confirmed yet
        const optimistic = prev.filter((m) => m.deliveryStatus === 'sending');
        const serverIds = new Set(commandMessages.map((m) => m.id));
        const unresolvedOptimistic = optimistic.filter((m) => !serverIds.has(m.id));
        return [...commandMessages, ...unresolvedOptimistic];
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch and polling (reduced interval when WS is connected)
  useEffect(() => {
    if (!isActive) return;

    void fetchMessages();

    // When WS is connected, poll much less frequently (just for consistency check)
    // When WS is not connected, poll at normal rate
    const interval = wsConnected ? 120000 : 30000;
    const intervalId = setInterval(() => void fetchMessages(), interval);

    return () => clearInterval(intervalId);
  }, [isActive, fetchMessages, wsConnected]);

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

  // Handle sending a message
  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || sending) return;

    setInputValue('');

    // Try WebSocket first
    if (wsConnected) {
      const clientId = crypto.randomUUID();
      const sent = wsSendMessage(text, coordinatorAddress, clientId);
      if (sent) {
        // Optimistic: add message immediately with 'sending' status
        const optimisticMsg: ChatMessage = {
          id: `optimistic-${clientId}`,
          clientId,
          from: 'overseer',
          to: coordinatorAddress,
          subject: text.slice(0, 50) + (text.length > 50 ? '...' : ''),
          body: text,
          timestamp: new Date().toISOString(),
          read: true,
          priority: 2,
          type: 'reply',
          threadId: '',
          pinned: false,
          deliveryStatus: 'sending',
        };
        setMessages((prev) => [...prev, optimisticMsg]);
        inputRef.current?.focus();
        return;
      }
      // If WS send failed, fall through to HTTP
    }

    // HTTP fallback
    setSending(true);
    try {
      const request: SendMessageRequest = {
        from: 'overseer',
        to: coordinatorAddress,
        subject: text.slice(0, 50) + (text.length > 50 ? '...' : ''),
        body: text,
        priority: 2,
        type: 'reply',
      };

      await api.mail.send(request);
      await fetchMessages();
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
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
  const handlePlayMessage = async (msg: ChatMessage) => {
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

  if (loading) {
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

      {/* Error banner */}
      {error && (
        <div className="chat-error" role="alert">
          {error}
          <button onClick={() => setError(null)} className="chat-error-dismiss">
            x
          </button>
        </div>
      )}

      {/* Messages container */}
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p>NO MESSAGES YET</p>
            <p className="chat-empty-hint">Send a message to {coordinatorName} below</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = isUserMessage(msg);
            const isPlayingThis = playingMessageId === msg.id;
            const isLoadingThis = isPlayingThis && voicePlayer.isLoading;
            return (
              <div
                key={msg.id}
                className={`chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-command'} ${msg.deliveryStatus === 'sending' ? 'chat-bubble-sending' : ''}`}
              >
                <div className="chat-bubble-header">
                  <span className="chat-bubble-sender">
                    {isUser ? 'YOU' : coordinatorName}
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
                  {msg.deliveryStatus === 'sending' && (
                    <span className="chat-delivery-status">SENDING </span>
                  )}
                  {msg.deliveryStatus === 'delivered' && (
                    <span className="chat-delivery-status chat-delivery-confirmed">DELIVERED </span>
                  )}
                  {formatTimestamp(msg.timestamp)}
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
