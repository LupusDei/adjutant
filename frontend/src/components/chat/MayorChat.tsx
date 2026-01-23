/**
 * MayorChat Component - SMS-style conversation with the Mayor
 * Part of 005-overseer-views feature
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../services/api';
import type { Message, SendMessageRequest } from '../../types';
import './chat.css';

export interface MayorChatProps {
  /** Whether this tab is currently active */
  isActive?: boolean;
}

/** Thread ID for mayor conversations */
const MAYOR_THREAD_PREFIX = 'mayor-chat';

/**
 * Check if a message is part of a mayor conversation.
 */
function isMayorMessage(msg: Message): boolean {
  const fromLower = msg.from.toLowerCase();
  const toLower = msg.to.toLowerCase();
  return (
    fromLower.includes('mayor') ||
    toLower.includes('mayor') ||
    fromLower.includes('overseer') ||
    toLower.includes('overseer')
  );
}

/**
 * Check if message is from the user (overseer side).
 */
function isUserMessage(msg: Message): boolean {
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
 * MayorChat - SMS-style conversation interface with the Mayor.
 */
export const MayorChat: React.FC<MayorChatProps> = ({ isActive = true }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom when messages change
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Fetch mayor-related messages
  const fetchMessages = useCallback(async () => {
    try {
      const response = await api.mail.list({ all: true });
      const mayorMessages = response.items
        .filter(isMayorMessage)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      setMessages(mayorMessages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch and polling
  useEffect(() => {
    if (!isActive) return;

    void fetchMessages();
    const intervalId = setInterval(() => void fetchMessages(), 30000);

    return () => clearInterval(intervalId);
  }, [isActive, fetchMessages]);

  // Scroll to bottom when messages update
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Handle sending a message
  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || sending) return;

    setSending(true);
    setInputValue('');

    try {
      const request: SendMessageRequest = {
        from: 'overseer',
        to: 'mayor/',
        subject: text.slice(0, 50) + (text.length > 50 ? '...' : ''),
        body: text,
        priority: 2,
        type: 'reply',
        threadId: `${MAYOR_THREAD_PREFIX}-${Date.now()}`,
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

  if (loading) {
    return (
      <div className="mayor-chat">
        <div className="chat-loading">
          <div className="chat-loading-spinner" />
          ESTABLISHING SECURE CHANNEL...
        </div>
      </div>
    );
  }

  return (
    <div className="mayor-chat">
      {/* Header */}
      <header className="chat-header">
        <h2 className="chat-title">MAYOR DIRECT LINE</h2>
        <span className="chat-status">
          {messages.length} MESSAGES
        </span>
      </header>

      {/* Error banner */}
      {error && (
        <div className="chat-error" role="alert">
          {error}
          <button onClick={() => setError(null)} className="chat-error-dismiss">
            ×
          </button>
        </div>
      )}

      {/* Messages container */}
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p>NO MESSAGES YET</p>
            <p className="chat-empty-hint">Send a message to the Mayor below</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = isUserMessage(msg);
            return (
              <div
                key={msg.id}
                className={`chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-mayor'}`}
              >
                <div className="chat-bubble-sender">
                  {isUser ? 'YOU' : 'MAYOR'}
                </div>
                <div className="chat-bubble-content">
                  {msg.body}
                </div>
                <div className="chat-bubble-time">
                  {formatTimestamp(msg.timestamp)}
                </div>
              </div>
            );
          })
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

export default MayorChat;
