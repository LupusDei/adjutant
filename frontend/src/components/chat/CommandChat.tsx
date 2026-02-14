/**
 * CommandChat Component - SMS-style conversation with the coordinator
 * Works in both Gas Town (Mayor) and standalone (User) modes
 * Part of 005-overseer-views feature
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../services/api';
import type { Message, SendMessageRequest } from '../../types';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useVoicePlayer } from '../../hooks/useVoicePlayer';
import { useDeploymentMode } from '../../hooks/useDeploymentMode';
import './chat.css';

export interface CommandChatProps {
  /** Whether this tab is currently active */
  isActive?: boolean;
}

/**
 * Check if a message is part of a command/coordinator conversation.
 * Works for both Gas Town (mayor/overseer) and standalone (user/agent) modes.
 */
function isCommandMessage(msg: Message): boolean {
  const fromLower = msg.from.toLowerCase();
  const toLower = msg.to.toLowerCase();
  return (
    // Gas Town mode
    fromLower.includes('mayor') ||
    toLower.includes('mayor') ||
    fromLower.includes('overseer') ||
    toLower.includes('overseer') ||
    // Standalone mode
    fromLower === 'user' ||
    toLower === 'user'
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
 * CommandChat - SMS-style conversation interface with the coordinator.
 * Adapts to deployment mode (Gas Town: Mayor, Standalone: User).
 */
export const CommandChat: React.FC<CommandChatProps> = ({ isActive = true }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Get deployment mode for UI labels
  const { isGasTown } = useDeploymentMode();

  // Determine coordinator name based on mode
  const coordinatorName = isGasTown ? 'MAYOR' : 'COMMAND';
  const coordinatorAddress = isGasTown ? 'mayor/' : 'user';

  // Voice input hook for recording
  const voiceInput = useVoiceInput();

  // Voice player hook for playback
  const voicePlayer = useVoicePlayer();

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

  // Fetch command-related messages
  const fetchMessages = useCallback(async () => {
    try {
      const response = await api.mail.list({ all: true });
      const commandMessages = response.items
        .filter(isCommandMessage)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      setMessages(commandMessages);
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

  // Handle voice recording
  const handleMicClick = async () => {
    if (voiceInput.isRecording) {
      voiceInput.stopRecording();
    } else {
      await voiceInput.startRecording();
    }
  };

  // Handle playing a message
  const handlePlayMessage = async (msg: Message) => {
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

  return (
    <div className="command-chat">
      {/* Header */}
      <header className="chat-header">
        <h2 className="chat-title">{coordinatorName} DIRECT LINE</h2>
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
                className={`chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-command'}`}
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
                    {isLoadingThis ? '◌' : isPlayingThis ? '⏹' : '▶'}
                  </button>
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
        <button
          type="button"
          onClick={() => void handleMicClick()}
          disabled={sending || voiceInput.isProcessing}
          className={`chat-mic-btn ${voiceInput.isRecording ? 'chat-mic-btn-recording' : ''}`}
          aria-label={voiceInput.isRecording ? 'Stop recording' : 'Start recording'}
          title={voiceInput.isRecording ? 'Stop recording' : 'Record voice message'}
        >
          {voiceInput.isProcessing ? '◌' : voiceInput.isRecording ? '⏹' : '🎤'}
        </button>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
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
