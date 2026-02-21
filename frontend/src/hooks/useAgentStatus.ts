/**
 * useAgentStatus - Hook for tracking real-time agent status via WebSocket.
 *
 * Subscribes to WebSocket messages with metadata.type === 'agent_status'
 * and maintains a Map of agent statuses keyed by agentId.
 */

import { useState, useEffect, useCallback } from 'react';

import { useCommunication, type IncomingChatMessage } from '../contexts/CommunicationContext';

export interface AgentStatusInfo {
  status: string;
  task?: string;
  percentage?: number;
  beadId?: string;
}

export interface UseAgentStatusResult {
  statuses: Map<string, AgentStatusInfo>;
}

interface IncomingWithMetadata extends IncomingChatMessage {
  metadata?: {
    type?: string;
    status?: string;
    task?: string;
    percentage?: number;
    beadId?: string;
  };
}

export function useAgentStatus(): UseAgentStatusResult {
  const [statuses, setStatuses] = useState<Map<string, AgentStatusInfo>>(new Map());
  const { subscribe } = useCommunication();

  const handleMessage = useCallback((incoming: IncomingWithMetadata) => {
    const meta = incoming.metadata;
    if (!meta || meta.type !== 'agent_status') return;

    const agentId = incoming.from;
    const info: AgentStatusInfo = {
      status: meta.status ?? 'unknown',
    };
    if (meta.task !== undefined) info.task = meta.task;
    if (meta.percentage !== undefined) info.percentage = meta.percentage;
    if (meta.beadId !== undefined) info.beadId = meta.beadId;

    setStatuses((prev) => {
      const next = new Map(prev);
      next.set(agentId, info);
      return next;
    });
  }, []);

  useEffect(() => {
    // The subscribe callback receives IncomingChatMessage but our WS messages
    // may carry extra metadata fields. Cast to handle the extended type.
    const unsubscribe = subscribe(handleMessage as (msg: IncomingChatMessage) => void);
    return unsubscribe;
  }, [subscribe, handleMessage]);

  return { statuses };
}
