/**
 * ChatView - Chat tab wrapper with agent selector.
 *
 * Renders a RecipientSelector at the top so the user can pick which agent
 * to chat with, then renders CommandChat scoped to that agent.
 */
import { useState, useEffect } from 'react';

import { CommandChat } from './CommandChat';
import { ChatAgentSelector } from './ChatAgentSelector';
import { useUnreadCounts } from '../../hooks/useUnreadCounts';

export interface ChatViewProps {
  isActive?: boolean;
  initialAgent?: string;
  onInitialAgentConsumed?: () => void;
}

export function ChatView({ isActive = true, initialAgent, onInitialAgentConsumed }: ChatViewProps) {
  const [selectedAgent, setSelectedAgent] = useState('');
  const { counts } = useUnreadCounts();

  // Navigate to agent when initialAgent changes (from dashboard crew card tap)
  useEffect(() => {
    if (initialAgent && initialAgent.length > 0) {
      setSelectedAgent(initialAgent);
      onInitialAgentConsumed?.();
    }
  }, [initialAgent, onInitialAgentConsumed]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '8px 16px',
        borderBottom: '1px solid var(--crt-phosphor-dim, #00aa00)',
        background: '#050505',
        flexShrink: 0,
      }}>
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
    </div>
  );
}

export default ChatView;
