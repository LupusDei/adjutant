/**
 * Unit tests for notification-queue service
 * T036 [US3] - Tests for audio notification queue
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// Mock voice-service
vi.mock('../../src/services/voice-service.js', () => ({
  synthesizeMessage: vi.fn(),
}));

import {
  NotificationQueue,
  createNotificationQueue,
  type NotificationItem,
  type NotificationPriority,
} from '../../src/services/notification-queue.js';
import { synthesizeMessage } from '../../src/services/voice-service.js';

describe('NotificationQueue', () => {
  let queue: NotificationQueue;
  const mockSynthesize = synthesizeMessage as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    queue = createNotificationQueue();
    mockSynthesize.mockResolvedValue({ audioUrl: '/api/voice/audio/test.mp3', cached: false });
  });

  describe('enqueue', () => {
    it('should add notification to the queue', async () => {
      const notification: NotificationItem = {
        id: 'notif-1',
        text: 'New message from Mayor',
        priority: 'high',
        source: 'mail',
      };

      await queue.enqueue(notification);

      expect(queue.size()).toBe(1);
    });

    it('should assign default priority when not specified', async () => {
      const notification = {
        id: 'notif-2',
        text: 'System update',
        source: 'system',
      };

      await queue.enqueue(notification as NotificationItem);

      const item = queue.peek();
      expect(item?.priority).toBe('normal');
    });

    it('should order queue by priority (high > normal > low)', async () => {
      await queue.enqueue({ id: 'low', text: 'Low', priority: 'low', source: 'system' });
      await queue.enqueue({ id: 'high', text: 'High', priority: 'high', source: 'mail' });
      await queue.enqueue({ id: 'normal', text: 'Normal', priority: 'normal', source: 'system' });

      const first = queue.peek();
      expect(first?.id).toBe('high');
    });

    it('should maintain FIFO order for same priority', async () => {
      await queue.enqueue({ id: 'first', text: 'First', priority: 'normal', source: 'system' });
      await queue.enqueue({ id: 'second', text: 'Second', priority: 'normal', source: 'system' });
      await queue.enqueue({ id: 'third', text: 'Third', priority: 'normal', source: 'system' });

      expect(queue.dequeue()?.id).toBe('first');
      expect(queue.dequeue()?.id).toBe('second');
      expect(queue.dequeue()?.id).toBe('third');
    });

    it('should prevent duplicate notifications by id', async () => {
      await queue.enqueue({ id: 'dup', text: 'First', priority: 'normal', source: 'system' });
      await queue.enqueue({ id: 'dup', text: 'Duplicate', priority: 'high', source: 'mail' });

      expect(queue.size()).toBe(1);
    });
  });

  describe('dequeue', () => {
    it('should remove and return the highest priority item', async () => {
      await queue.enqueue({ id: 'notif-1', text: 'Test', priority: 'normal', source: 'system' });

      const item = queue.dequeue();

      expect(item?.id).toBe('notif-1');
      expect(queue.size()).toBe(0);
    });

    it('should return undefined when queue is empty', () => {
      const item = queue.dequeue();
      expect(item).toBeUndefined();
    });
  });

  describe('peek', () => {
    it('should return the next item without removing it', async () => {
      await queue.enqueue({ id: 'notif-1', text: 'Test', priority: 'normal', source: 'system' });

      const item = queue.peek();

      expect(item?.id).toBe('notif-1');
      expect(queue.size()).toBe(1);
    });

    it('should return undefined when queue is empty', () => {
      const item = queue.peek();
      expect(item).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('should remove all items from the queue', async () => {
      await queue.enqueue({ id: 'notif-1', text: 'Test 1', priority: 'normal', source: 'system' });
      await queue.enqueue({ id: 'notif-2', text: 'Test 2', priority: 'high', source: 'mail' });

      queue.clear();

      expect(queue.size()).toBe(0);
    });
  });

  describe('isEmpty', () => {
    it('should return true when queue is empty', () => {
      expect(queue.isEmpty()).toBe(true);
    });

    it('should return false when queue has items', async () => {
      await queue.enqueue({ id: 'notif-1', text: 'Test', priority: 'normal', source: 'system' });
      expect(queue.isEmpty()).toBe(false);
    });
  });

  describe('priority ordering', () => {
    it('should process urgent notifications first', async () => {
      await queue.enqueue({ id: 'normal', text: 'Normal', priority: 'normal', source: 'system' });
      await queue.enqueue({ id: 'urgent', text: 'Urgent', priority: 'urgent', source: 'mail' });
      await queue.enqueue({ id: 'high', text: 'High', priority: 'high', source: 'mail' });

      expect(queue.dequeue()?.id).toBe('urgent');
      expect(queue.dequeue()?.id).toBe('high');
      expect(queue.dequeue()?.id).toBe('normal');
    });

    it('should handle all priority levels correctly', async () => {
      const priorities: NotificationPriority[] = ['low', 'normal', 'high', 'urgent'];

      // Add in reverse order
      for (const priority of priorities) {
        await queue.enqueue({ id: priority, text: priority, priority, source: 'system' });
      }

      expect(queue.dequeue()?.id).toBe('urgent');
      expect(queue.dequeue()?.id).toBe('high');
      expect(queue.dequeue()?.id).toBe('normal');
      expect(queue.dequeue()?.id).toBe('low');
    });
  });

  describe('notification source filtering', () => {
    it('should support filtering by source', async () => {
      await queue.enqueue({ id: 'mail-1', text: 'Mail 1', priority: 'normal', source: 'mail' });
      await queue.enqueue({ id: 'system-1', text: 'System 1', priority: 'normal', source: 'system' });
      await queue.enqueue({ id: 'mail-2', text: 'Mail 2', priority: 'normal', source: 'mail' });

      const mailOnly = queue.getBySource('mail');
      expect(mailOnly).toHaveLength(2);
      expect(mailOnly.map((n) => n.id)).toEqual(['mail-1', 'mail-2']);
    });
  });

  describe('queue events', () => {
    it('should emit event when item is enqueued', async () => {
      const onEnqueue = vi.fn();
      queue.on('enqueue', onEnqueue);

      await queue.enqueue({ id: 'notif-1', text: 'Test', priority: 'normal', source: 'system' });

      expect(onEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'notif-1' })
      );
    });

    it('should emit event when item is dequeued', async () => {
      const onDequeue = vi.fn();
      queue.on('dequeue', onDequeue);

      await queue.enqueue({ id: 'notif-1', text: 'Test', priority: 'normal', source: 'system' });
      queue.dequeue();

      expect(onDequeue).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'notif-1' })
      );
    });

    it('should allow removing event listeners', async () => {
      const onEnqueue = vi.fn();
      queue.on('enqueue', onEnqueue);
      queue.off('enqueue', onEnqueue);

      await queue.enqueue({ id: 'notif-1', text: 'Test', priority: 'normal', source: 'system' });

      expect(onEnqueue).not.toHaveBeenCalled();
    });
  });

  describe('TTL (time-to-live)', () => {
    it('should expire notifications after TTL', async () => {
      vi.useFakeTimers();

      await queue.enqueue({
        id: 'expiring',
        text: 'Will expire',
        priority: 'normal',
        source: 'system',
        ttl: 5000, // 5 seconds
      });

      expect(queue.size()).toBe(1);

      // Advance time past TTL
      vi.advanceTimersByTime(6000);

      // Expired items should be removed when accessed
      expect(queue.peek()).toBeUndefined();
      expect(queue.size()).toBe(0);

      vi.useRealTimers();
    });

    it('should keep notifications without TTL indefinitely', async () => {
      vi.useFakeTimers();

      await queue.enqueue({
        id: 'permanent',
        text: 'No expiry',
        priority: 'normal',
        source: 'system',
      });

      vi.advanceTimersByTime(60000); // 1 minute

      expect(queue.peek()?.id).toBe('permanent');

      vi.useRealTimers();
    });
  });
});
