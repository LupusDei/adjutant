/**
 * useTimeline - Hook for fetching and managing timeline events.
 *
 * Fetches events from GET /api/events/timeline with filter support,
 * cursor-based pagination (load more), and real-time WebSocket updates.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

import { getTimelineEvents, type TimelineEvent } from '../services/api';
import { useCommunication } from '../contexts/CommunicationContext';

export type TimeRange = '1h' | '6h' | '24h' | '7d' | 'all';

export interface TimelineFilters {
  agentId?: string;
  eventType?: string;
  beadId?: string;
  timeRange?: TimeRange;
}

export interface UseTimelineResult {
  events: TimelineEvent[];
  loading: boolean;
  hasMore: boolean;
  error: Error | null;
  filters: TimelineFilters;
  setFilters: (filters: TimelineFilters) => void;
  loadMore: () => Promise<void>;
}

function timeRangeToAfter(range: TimeRange | undefined): string | undefined {
  if (!range || range === 'all') return undefined;
  const now = Date.now();
  const offsets: Record<string, number> = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  };
  const offset = offsets[range];
  if (!offset) return undefined;
  return new Date(now - offset).toISOString();
}

export function useTimeline(): UseTimelineResult {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [filters, setFilters] = useState<TimelineFilters>({});

  const mountedRef = useRef(true);
  const { subscribe } = useCommunication();

  // Fetch events from REST API
  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params: Parameters<typeof getTimelineEvents>[0] = {
        limit: 50,
      };
      if (filters.agentId) params.agentId = filters.agentId;
      if (filters.eventType) params.eventType = filters.eventType;
      if (filters.beadId) params.beadId = filters.beadId;
      const after = timeRangeToAfter(filters.timeRange);
      if (after) params.after = after;

      const response = await getTimelineEvents(params);

      if (mountedRef.current) {
        setEvents(response.events);
        setHasMore(response.hasMore);
        setLoading(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    }
  }, [filters]);

  // Initial fetch and refetch when filters change
  useEffect(() => {
    mountedRef.current = true;
    void fetchEvents();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchEvents]);

  // Subscribe to real-time timeline_event messages via WebSocket
  // The CommunicationContext subscribe gives us chat_message events,
  // but timeline events come through SSE. We'll use an EventSource listener.
  useEffect(() => {
    let es: EventSource | null = null;

    try {
      es = new EventSource('/api/events');

      es.addEventListener('timeline_event', (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string) as TimelineEvent;

          // Apply filters client-side for real-time events
          if (filters.agentId && data.agentId !== filters.agentId) return;
          if (filters.eventType && data.eventType !== filters.eventType) return;
          if (filters.beadId && data.beadId !== filters.beadId) return;

          setEvents((prev) => {
            // Deduplicate
            if (prev.some((e) => e.id === data.id)) return prev;
            return [data, ...prev];
          });
        } catch {
          // Ignore parse errors
        }
      });

      es.onerror = () => {
        // EventSource auto-reconnects
      };
    } catch {
      // EventSource not supported
    }

    return () => {
      es?.close();
    };
  }, [filters, subscribe]);

  // Load older events (pagination)
  const loadMore = useCallback(async () => {
    if (!hasMore || events.length === 0) return;

    const oldestEvent = events[events.length - 1];

    try {
      const params: Parameters<typeof getTimelineEvents>[0] = {
        before: oldestEvent.createdAt,
        limit: 50,
      };
      if (filters.agentId) params.agentId = filters.agentId;
      if (filters.eventType) params.eventType = filters.eventType;
      if (filters.beadId) params.beadId = filters.beadId;
      const after = timeRangeToAfter(filters.timeRange);
      if (after) params.after = after;

      const response = await getTimelineEvents(params);

      if (mountedRef.current) {
        setEvents((prev) => {
          const existingIds = new Set(prev.map((e) => e.id));
          const newEvents = response.events.filter((e) => !existingIds.has(e.id));
          return [...prev, ...newEvents];
        });
        setHasMore(response.hasMore);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }, [events, hasMore, filters]);

  return {
    events,
    loading,
    hasMore,
    error,
    filters,
    setFilters,
    loadMore,
  };
}
