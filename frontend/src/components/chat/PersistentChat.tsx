/**
 * PersistentChat - Agent chat view backed by persistent SQLite messages.
 *
 * Uses useChatMessages for persistent message fetch + real-time WebSocket updates.
 * Shows agent status from useAgentStatus. Includes AnnouncementBanner.
 * Maintains the existing CRT aesthetic and SMS bubble style.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';


import { useChatMessages, type DisplayMessage } from '../../hooks/useChatMessages';
import { useUnreadCounts } from '../../hooks/useUnreadCounts';
import { useAgentStatus } from '../../hooks/useAgentStatus';
import { useCommunication } from '../../contexts/CommunicationContext';
import type { ConnectionStatus } from '../../types';
import { AnnouncementBanner } from './AnnouncementBanner';
import './chat.css';

export interface PersistentChatProps {
  /** Agent ID to filter messages for. Undefined shows all messages. */
  agentId?: string;
  /** Whether this tab is currently active */
  isActive?: boolean;
}

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

function getStatusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'websocket': return 'WS';
    case 'sse': return 'SSE';
    case 'polling': return 'HTTP';
    case 'reconnecting': return 'RECONNECTING';
    case 'disconnected': return 'OFFLINE';
  }
}

function getStatusClass(status: ConnectionStatus): string {
  switch (status) {
    case 'websocket': return 'comm-indicator-ws';
    case 'sse': return 'comm-indicator-sse';
    case 'polling': return 'comm-indicator-polling';
    case 'reconnecting': return 'comm-indicator-reconnecting';
    case 'disconnected': return 'comm-indicator-disconnected';
  }
}

export const PersistentChat: React.FC<PersistentChatProps> = ({ agentId, isActive = true }) => {
  const { messages, isLoading, error, hasMore, sendMessage, loadMore } = useChatMessages(agentId);
  const { markRead } = useUnreadCounts();
  const { statuses } = useAgentStatus();
  const { connectionStatus } = useCommunication();

  // Mark conversation as read when opened
  useEffect(() => {
    if (agentId && isActive) {
      void markRead(agentId);
    }
  }, [agentId, isActive, markRead]);

  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // IntersectionObserver for infinite scroll
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

  // Handle sending a message
  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || sending) return;

    setInputValue('');
    setSending(true);
    setSendError(null);

    try {
      await sendMessage(text);
      inputRef.current?.focus();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send');
      setInputValue(text);
    } finally {
      setSending(false);
    }
  }, [inputValue, sending, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // Agent status for the selected agent
  const agentStatus = agentId ? statuses.get(agentId) : undefined;

  if (isLoading) {
    return (
      <div className="command-chat">
        <div className="chat-loading">
          <div className="chat-loading-spinner" />
          LOADING MESSAGES...
        </div>
      </div>
    );
  }

  return (
    <div className="command-chat">
      {/* Announcement Banner */}
      <AnnouncementBanner />

      {/* Header */}
      <header className="chat-header">
        <h2 className="chat-title">
          {agentId ? agentId.toUpperCase() : 'ALL AGENTS'}
        </h2>
        <div className="chat-header-right">
          {agentStatus && (
            <span className="agent-status-badge">
              {agentStatus.status.toUpperCase()}
              {agentStatus.percentage != null && ` ${agentStatus.percentage}%`}
            </span>
          )}
          <span className={`comm-indicator ${getStatusClass(connectionStatus)}`}>
            {getStatusLabel(connectionStatus)}
          </span>
          <span className="chat-status">
            {messages.length} MESSAGES
          </span>
        </div>
      </header>

      {/* Error banner */}
      {(error || sendError) && (
        <div className="chat-error" role="alert">
          {error?.message ?? sendError}
          <button
            onClick={() => setSendError(null)}
            className="chat-error-dismiss"
          >
            x
          </button>
        </div>
      )}

      {/* Messages container */}
      <div className="chat-messages">
        {/* Infinite scroll sentinel */}
        {hasMore && (
          <div ref={loadMoreSentinelRef} className="chat-load-more">
            {loadingMore ? 'LOADING...' : 'SCROLL UP FOR MORE'}
          </div>
        )}

        {messages.length === 0 ? (
          <div className="chat-empty">
            <p>NO MESSAGES YET</p>
            <p className="chat-empty-hint">
              {agentId ? `No messages with ${agentId}` : 'No messages found'}
            </p>
          </div>
        ) : (
          messages.map((msg: DisplayMessage) => {
            const isUser = msg.role === 'user';
            const isSystem = msg.role === 'system' || msg.role === 'announcement';

            if (isSystem) {
              return (
                <div key={msg.id} className="chat-system-message">
                  <span className="chat-system-body">{msg.body}</span>
                  <span className="chat-system-time">{formatTimestamp(msg.createdAt)}</span>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className={`chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-command'}`}
              >
                <div className="chat-bubble-header">
                  <span className="chat-bubble-sender">
                    {isUser ? 'YOU' : (msg.agentId ?? 'AGENT').toUpperCase()}
                  </span>
                </div>
                <div className="chat-bubble-content">
                  {msg.body}
                </div>
                <div className="chat-bubble-time">
                  {formatTimestamp(msg.createdAt)}
                </div>
              </div>
            );
          })
        )}

        {/* Agent status indicator */}
        {agentStatus?.status === 'working' && agentStatus.task && (
          <div className="chat-typing-indicator">
            <span className="chat-typing-dots">
              <span>.</span><span>.</span><span>.</span>
            </span>
            {' '}{agentStatus.task}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="chat-input-area">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="TYPE MESSAGE..."
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
};

export default PersistentChat;
