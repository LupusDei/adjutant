/**
 * useCrewMessaging hook for sending messages to crew members.
 *
 * Provides utilities for addressing and messaging specific crew members
 * (polecats, witnesses, refineries, crew).
 */

import { useState, useCallback, useMemo } from 'react';
import { api } from '../services/api';
import type { CrewMember, SendMessageRequest, MessagePriority, MessageType } from '../types';
import { usePolling } from './usePolling';

/**
 * Build a mail address from a crew member.
 *
 * Address formats:
 * - Mayor: "mayor/"
 * - Deacon: "deacon/"
 * - Witness: "{rig}/witness"
 * - Refinery: "{rig}/refinery"
 * - Crew: "{rig}/{name}"
 * - Polecat: "{rig}/{name}"
 */
export function buildCrewAddress(member: CrewMember): string {
  switch (member.type) {
    case 'mayor':
      return 'mayor/';
    case 'deacon':
      return 'deacon/';
    case 'witness':
      return member.rig ? `${member.rig}/witness` : member.id;
    case 'refinery':
      return member.rig ? `${member.rig}/refinery` : member.id;
    case 'crew':
    case 'polecat':
      return member.rig ? `${member.rig}/${member.name}` : member.id;
    default:
      return member.id;
  }
}

/**
 * Check if a message is from or to a specific crew member.
 */
export function isMessageForCrewMember(
  messageFromOrTo: string,
  member: CrewMember
): boolean {
  const address = buildCrewAddress(member);
  const normalized = messageFromOrTo.toLowerCase().replace(/\/$/, '');
  const addressNormalized = address.toLowerCase().replace(/\/$/, '');
  return normalized === addressNormalized || normalized.includes(addressNormalized);
}

/**
 * Check if a message involves any crew member (not mayor/overseer).
 */
export function isCrewMessage(from: string, to: string): boolean {
  const lowerFrom = from.toLowerCase();
  const lowerTo = to.toLowerCase();

  // Messages involving mayor/overseer are not crew messages
  const isOverseer =
    lowerFrom.includes('mayor') ||
    lowerFrom.includes('overseer') ||
    lowerTo.includes('mayor') ||
    lowerTo.includes('overseer');

  // Check for crew-like addresses (rig/name pattern)
  const hasCrewPattern =
    /^[a-z0-9_-]+\/[a-z0-9_-]+$/i.test(from.replace(/\/$/, '')) ||
    /^[a-z0-9_-]+\/[a-z0-9_-]+$/i.test(to.replace(/\/$/, ''));

  return !isOverseer && hasCrewPattern;
}

/** Request for sending a message to a crew member */
export interface CrewMessageRequest {
  /** The crew member to send to */
  to: CrewMember;
  /** Message subject */
  subject: string;
  /** Message body */
  body: string;
  /** Priority (default: 2 = normal) */
  priority?: MessagePriority;
  /** Message type (default: 'task') */
  type?: MessageType;
  /** ID of message being replied to */
  replyTo?: string;
}

/** Options for useCrewMessaging hook */
export interface UseCrewMessagingOptions {
  /** Polling interval for crew list in ms (default: 60000) */
  pollInterval?: number;
  /** Whether to poll for crew list (default: true) */
  enabled?: boolean;
}

/** Return type for useCrewMessaging hook */
export interface UseCrewMessagingResult {
  /** Available crew members to message */
  crewMembers: CrewMember[];
  /** Whether crew list is loading */
  loading: boolean;
  /** Error from loading crew list */
  error: Error | null;
  /** Refresh the crew list */
  refreshCrew: () => Promise<void>;
  /** Send a message to a crew member */
  sendToCrewMember: (request: CrewMessageRequest) => Promise<{ messageId: string }>;
  /** Whether a send is in progress */
  sending: boolean;
  /** Error from last send */
  sendError: Error | null;
  /** Clear send error */
  clearSendError: () => void;
  /** Filter crew members by type */
  filterByType: (types: CrewMember['type'][]) => CrewMember[];
  /** Filter crew members by rig */
  filterByRig: (rig: string) => CrewMember[];
  /** Get online (non-offline) crew members */
  onlineCrew: CrewMember[];
}

/**
 * Hook for messaging crew members.
 *
 * @example
 * ```tsx
 * const { crewMembers, sendToCrewMember, sending } = useCrewMessaging();
 *
 * const handleSend = async () => {
 *   await sendToCrewMember({
 *     to: crewMembers[0],
 *     subject: 'Task assignment',
 *     body: 'Please work on feature X',
 *   });
 * };
 * ```
 */
export function useCrewMessaging(
  options: UseCrewMessagingOptions = {}
): UseCrewMessagingResult {
  const { pollInterval = 60000, enabled = true } = options;

  // Crew list state via polling
  const {
    data: crewMembers,
    loading,
    error,
    refresh: refreshCrew,
  } = usePolling<CrewMember[]>(() => api.agents.list(), {
    interval: pollInterval,
    enabled,
  });

  // Send state
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<Error | null>(null);

  // Clear send error
  const clearSendError = useCallback(() => {
    setSendError(null);
  }, []);

  // Send message to crew member
  const sendToCrewMember = useCallback(
    async (request: CrewMessageRequest): Promise<{ messageId: string }> => {
      setSendError(null);
      setSending(true);

      try {
        const mailRequest: SendMessageRequest = {
          to: buildCrewAddress(request.to),
          subject: request.subject,
          body: request.body,
          priority: request.priority ?? 2,
          type: request.type ?? 'task',
        };

        // Only add replyTo if it's defined
        if (request.replyTo) {
          mailRequest.replyTo = request.replyTo;
        }

        const result = await api.mail.send(mailRequest);
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setSendError(error);
        throw error;
      } finally {
        setSending(false);
      }
    },
    []
  );

  // Filter helpers
  const filterByType = useCallback(
    (types: CrewMember['type'][]): CrewMember[] => {
      if (!crewMembers) return [];
      return crewMembers.filter((m) => types.includes(m.type));
    },
    [crewMembers]
  );

  const filterByRig = useCallback(
    (rig: string): CrewMember[] => {
      if (!crewMembers) return [];
      return crewMembers.filter((m) => m.rig === rig);
    },
    [crewMembers]
  );

  // Online crew members
  const onlineCrew = useMemo(
    () => (crewMembers ?? []).filter((m) => m.status !== 'offline'),
    [crewMembers]
  );

  return {
    crewMembers: crewMembers ?? [],
    loading,
    error,
    refreshCrew,
    sendToCrewMember,
    sending,
    sendError,
    clearSendError,
    filterByType,
    filterByRig,
    onlineCrew,
  };
}

export default useCrewMessaging;
