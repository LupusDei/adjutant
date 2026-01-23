/**
 * Notification Queue Service - T038 [US3]
 * Priority queue for audio notifications with FIFO ordering within priority levels
 */

// =============================================================================
// Types
// =============================================================================

export type NotificationPriority = 'urgent' | 'high' | 'normal' | 'low';
export type NotificationSource = 'mail' | 'system' | 'agent' | 'custom';
export type QueueEvent = 'enqueue' | 'dequeue' | 'clear';

export interface NotificationItem {
  id: string;
  text: string;
  priority: NotificationPriority;
  source: NotificationSource;
  /** Time-to-live in milliseconds. Undefined means no expiration. */
  ttl?: number;
  /** Timestamp when notification was enqueued */
  enqueuedAt?: number;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

type EventHandler = (item: NotificationItem) => void;

export interface NotificationQueue {
  enqueue(item: NotificationItem | Omit<NotificationItem, 'priority'>): Promise<void>;
  dequeue(): NotificationItem | undefined;
  peek(): NotificationItem | undefined;
  size(): number;
  isEmpty(): boolean;
  clear(): void;
  getBySource(source: NotificationSource): NotificationItem[];
  on(event: QueueEvent, handler: EventHandler): void;
  off(event: QueueEvent, handler: EventHandler): void;
}

// =============================================================================
// Priority Weights
// =============================================================================

const PRIORITY_WEIGHTS: Record<NotificationPriority, number> = {
  urgent: 4,
  high: 3,
  normal: 2,
  low: 1,
};

// =============================================================================
// Implementation
// =============================================================================

interface QueueEntry extends NotificationItem {
  enqueuedAt: number;
}

/**
 * Creates a new notification queue instance.
 */
export function createNotificationQueue(): NotificationQueue {
  const items: QueueEntry[] = [];
  const seenIds = new Set<string>();
  const eventHandlers: Map<QueueEvent, Set<EventHandler>> = new Map([
    ['enqueue', new Set()],
    ['dequeue', new Set()],
    ['clear', new Set()],
  ]);

  /**
   * Remove expired items from the queue
   */
  function pruneExpired(): void {
    const now = Date.now();
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item !== undefined && item.ttl !== undefined) {
        const expiresAt = item.enqueuedAt + item.ttl;
        if (now > expiresAt) {
          seenIds.delete(item.id);
          items.splice(i, 1);
        }
      }
    }
  }

  /**
   * Insert item in priority order (higher priority first, FIFO within same priority)
   */
  function insertSorted(entry: QueueEntry): void {
    const weight = PRIORITY_WEIGHTS[entry.priority];

    // Find insertion point
    let insertIndex = items.length;
    for (let i = 0; i < items.length; i++) {
      const existingItem = items[i];
      if (existingItem !== undefined) {
        const existingWeight = PRIORITY_WEIGHTS[existingItem.priority];
        if (weight > existingWeight) {
          insertIndex = i;
          break;
        }
      }
    }

    items.splice(insertIndex, 0, entry);
  }

  /**
   * Emit event to all registered handlers
   */
  function emit(event: QueueEvent, item: NotificationItem): void {
    const handlers = eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(item);
        } catch {
          // Ignore handler errors
        }
      }
    }
  }

  return {
    async enqueue(
      item: NotificationItem | Omit<NotificationItem, 'priority'>
    ): Promise<void> {
      // Prevent duplicates
      if (seenIds.has(item.id)) {
        return;
      }

      const entry: QueueEntry = {
        ...item,
        priority: 'priority' in item ? item.priority : 'normal',
        enqueuedAt: Date.now(),
      };

      seenIds.add(entry.id);
      insertSorted(entry);
      emit('enqueue', entry);
    },

    dequeue(): NotificationItem | undefined {
      pruneExpired();

      const item = items.shift();
      if (item) {
        seenIds.delete(item.id);
        emit('dequeue', item);
      }
      return item;
    },

    peek(): NotificationItem | undefined {
      pruneExpired();
      return items[0];
    },

    size(): number {
      pruneExpired();
      return items.length;
    },

    isEmpty(): boolean {
      pruneExpired();
      return items.length === 0;
    },

    clear(): void {
      const clearedItems = [...items];
      items.length = 0;
      seenIds.clear();
      for (const item of clearedItems) {
        emit('clear', item);
      }
    },

    getBySource(source: NotificationSource): NotificationItem[] {
      pruneExpired();
      return items.filter((item) => item.source === source);
    },

    on(event: QueueEvent, handler: EventHandler): void {
      eventHandlers.get(event)?.add(handler);
    },

    off(event: QueueEvent, handler: EventHandler): void {
      eventHandlers.get(event)?.delete(handler);
    },
  };
}

// =============================================================================
// Singleton Instance
// =============================================================================

let defaultQueue: NotificationQueue | null = null;

/**
 * Get the default notification queue instance (singleton)
 */
export function getNotificationQueue(): NotificationQueue {
  if (!defaultQueue) {
    defaultQueue = createNotificationQueue();
  }
  return defaultQueue;
}

/**
 * Reset the default queue (mainly for testing)
 */
export function resetNotificationQueue(): void {
  if (defaultQueue) {
    defaultQueue.clear();
  }
  defaultQueue = null;
}

export default {
  createNotificationQueue,
  getNotificationQueue,
  resetNotificationQueue,
};
