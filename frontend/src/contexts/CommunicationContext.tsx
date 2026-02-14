import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from 'react';
import type { CommunicationPriority, ConnectionStatus } from '../types';

/**
 * Communication state and actions.
 */
export interface CommunicationContextValue {
  /** Current communication priority */
  priority: CommunicationPriority;
  /** Set the communication priority */
  setPriority: (priority: CommunicationPriority) => void;
  /** Current connection status */
  connectionStatus: ConnectionStatus;
}

const CommunicationContext = createContext<CommunicationContextValue | null>(null);

const STORAGE_KEY = 'adjutant-comm-priority';

/**
 * Provider component for communication priority state.
 * Manages which communication channels are active based on user preference.
 */
export function CommunicationProvider({ children }: { children: ReactNode }) {
  const [priority, setPriorityState] = useState<CommunicationPriority>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && ['real-time', 'efficient', 'polling-only'].includes(stored)) {
        return stored as CommunicationPriority;
      }
    } catch {
      // Ignore storage errors
    }
    return 'real-time';
  });

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');

  // Persist priority to localStorage and update connection strategy
  const setPriority = useCallback((newPriority: CommunicationPriority) => {
    setPriorityState(newPriority);
    try {
      localStorage.setItem(STORAGE_KEY, newPriority);
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Determine connection status based on priority
  // In a full implementation, this would manage actual WS/SSE connections
  useEffect(() => {
    switch (priority) {
      case 'real-time':
        setConnectionStatus('websocket');
        break;
      case 'efficient':
        setConnectionStatus('sse');
        break;
      case 'polling-only':
        setConnectionStatus('polling');
        break;
    }
  }, [priority]);

  const value = useMemo(() => ({
    priority,
    setPriority,
    connectionStatus,
  }), [priority, setPriority, connectionStatus]);

  return (
    <CommunicationContext.Provider value={value}>
      {children}
    </CommunicationContext.Provider>
  );
}

/**
 * Hook to access communication priority context.
 */
export function useCommunication(): CommunicationContextValue {
  const context = useContext(CommunicationContext);
  if (!context) {
    throw new Error('useCommunication must be used within a CommunicationProvider');
  }
  return context;
}

export default CommunicationContext;
