import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MailList } from '../../../../src/components/mail/MailList';
import type { Message } from '../../../../src/types';

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    from: 'mayor/',
    to: 'operator',
    subject: 'Test Subject',
    body: 'Test body content',
    timestamp: '2026-01-11T10:00:00Z',
    read: false,
    priority: 2,
    type: 'notification',
    threadId: 'thread-1',
    pinned: false,
    ...overrides,
  };
}

function createMockMessageList(count: number): Message[] {
  return Array.from({ length: count }, (_, i) =>
    createMockMessage({
      id: `msg-${i + 1}`,
      subject: `Subject ${i + 1}`,
      from: i % 2 === 0 ? 'mayor/' : 'witness/',
      read: i % 2 === 0,
      priority: (i % 5) as Message['priority'],
      timestamp: new Date(Date.now() - i * 3600000).toISOString(), // Each hour older
    })
  );
}

// =============================================================================
// Tests
// =============================================================================

describe('MailList', () => {
  // ===========================================================================
  // Rendering
  // ===========================================================================

  describe('rendering', () => {
    it('should render a list of messages', () => {
      const messages = createMockMessageList(3);
      render(<MailList messages={messages} />);

      expect(screen.getByText('Subject 1')).toBeInTheDocument();
      expect(screen.getByText('Subject 2')).toBeInTheDocument();
      expect(screen.getByText('Subject 3')).toBeInTheDocument();
    });

    it('should display message sender', () => {
      const messages = [createMockMessage({ from: 'mayor/' })];
      render(<MailList messages={messages} />);

      expect(screen.getByText('Mayor')).toBeInTheDocument();
    });

    it('should display formatted sender names', () => {
      const messages = [
        createMockMessage({ id: 'msg-1', from: 'witness/' }),
        createMockMessage({ id: 'msg-2', from: 'greenplace/Toast' }),
      ];
      render(<MailList messages={messages} />);

      expect(screen.getByText('Witness')).toBeInTheDocument();
      expect(screen.getByText('Greenplace/Toast')).toBeInTheDocument();
    });

    it('should show loading state', () => {
      render(<MailList messages={[]} loading={true} />);

      expect(screen.getByText('LOADING MESSAGES...')).toBeInTheDocument();
    });

    it('should show empty state when no messages', () => {
      render(<MailList messages={[]} />);

      expect(screen.getByText('NO MESSAGES')).toBeInTheDocument();
    });

    it('should not show empty state when loading', () => {
      render(<MailList messages={[]} loading={true} />);

      expect(screen.queryByText('NO MESSAGES')).not.toBeInTheDocument();
    });

    it('should render as a listbox with proper ARIA attributes', () => {
      const messages = createMockMessageList(2);
      render(<MailList messages={messages} />);

      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(screen.getAllByRole('option')).toHaveLength(2);
    });
  });

  // ===========================================================================
  // Selection
  // ===========================================================================

  describe('selection', () => {
    it('should call onSelect when a message is clicked', () => {
      const onSelect = vi.fn();
      const messages = createMockMessageList(3);

      render(<MailList messages={messages} onSelect={onSelect} />);

      fireEvent.click(screen.getByText('Subject 2'));

      expect(onSelect).toHaveBeenCalledWith('msg-2');
    });

    it('should mark selected message with aria-selected', () => {
      const messages = createMockMessageList(3);
      render(<MailList messages={messages} selectedId="msg-2" />);

      const options = screen.getAllByRole('option');
      expect(options[0]).toHaveAttribute('aria-selected', 'false');
      expect(options[1]).toHaveAttribute('aria-selected', 'true');
      expect(options[2]).toHaveAttribute('aria-selected', 'false');
    });

    it('should handle selection when onSelect is not provided', () => {
      const messages = createMockMessageList(2);

      render(<MailList messages={messages} />);

      // Should not throw
      fireEvent.click(screen.getByText('Subject 1'));
    });

    it('should handle null selectedId', () => {
      const messages = createMockMessageList(2);
      render(<MailList messages={messages} selectedId={null} />);

      const options = screen.getAllByRole('option');
      options.forEach(option => {
        expect(option).toHaveAttribute('aria-selected', 'false');
      });
    });
  });

  // ===========================================================================
  // Read/Unread Status
  // ===========================================================================

  describe('read/unread status', () => {
    it('should show unread indicator for unread messages', () => {
      const messages = [createMockMessage({ read: false })];
      render(<MailList messages={messages} />);

      expect(screen.getByText('●')).toBeInTheDocument();
    });

    it('should not show unread indicator for read messages', () => {
      const messages = [createMockMessage({ read: true })];
      render(<MailList messages={messages} />);

      expect(screen.queryByText('●')).not.toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Priority Indicators
  // ===========================================================================

  describe('priority indicators', () => {
    it('should show !!! for urgent priority (0)', () => {
      const messages = [createMockMessage({ priority: 0 })];
      render(<MailList messages={messages} />);

      expect(screen.getByText('!!!')).toBeInTheDocument();
    });

    it('should show !! for high priority (1)', () => {
      const messages = [createMockMessage({ priority: 1 })];
      render(<MailList messages={messages} />);

      expect(screen.getByText('!!')).toBeInTheDocument();
    });

    it('should show no indicator for normal priority (2)', () => {
      const messages = [createMockMessage({ priority: 2, subject: 'Normal Priority' })];
      render(<MailList messages={messages} />);

      // Priority indicator element exists but is empty
      const item = screen.getByRole('option');
      const prioritySpan = item.querySelector('[data-priority="2"]');
      expect(prioritySpan?.textContent).toBe('');
    });

    it('should show down arrow for low priority (3)', () => {
      const messages = [createMockMessage({ priority: 3 })];
      render(<MailList messages={messages} />);

      expect(screen.getByText('▽')).toBeInTheDocument();
    });

    it('should show double down arrow for lowest priority (4)', () => {
      const messages = [createMockMessage({ priority: 4 })];
      render(<MailList messages={messages} />);

      expect(screen.getByText('▽▽')).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Timestamp Formatting
  // ===========================================================================

  describe('timestamp formatting', () => {
    it('should show "NOW" for very recent messages', () => {
      const messages = [createMockMessage({ timestamp: new Date().toISOString() })];
      render(<MailList messages={messages} />);

      expect(screen.getByText('NOW')).toBeInTheDocument();
    });

    it('should show minutes for recent messages', () => {
      const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const messages = [createMockMessage({ timestamp: tenMinsAgo })];
      render(<MailList messages={messages} />);

      expect(screen.getByText('10m')).toBeInTheDocument();
    });

    it('should show hours for messages from today', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const messages = [createMockMessage({ timestamp: threeHoursAgo })];
      render(<MailList messages={messages} />);

      expect(screen.getByText('3h')).toBeInTheDocument();
    });

    it('should show days for messages from this week', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const messages = [createMockMessage({ timestamp: threeDaysAgo })];
      render(<MailList messages={messages} />);

      expect(screen.getByText('3d')).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Accessibility
  // ===========================================================================

  describe('accessibility', () => {
    it('should have accessible label on listbox', () => {
      const messages = createMockMessageList(2);
      render(<MailList messages={messages} />);

      expect(screen.getByRole('listbox')).toHaveAttribute('aria-label', 'Mail messages');
    });

    it('should use button elements for clickable messages', () => {
      const messages = createMockMessageList(2);
      render(<MailList messages={messages} />);

      const options = screen.getAllByRole('option');
      options.forEach(option => {
        expect(option.tagName).toBe('BUTTON');
        expect(option).toHaveAttribute('type', 'button');
      });
    });

    it('should include subject in title for truncated text', () => {
      const longSubject = 'This is a very long subject line that might get truncated in the UI';
      const messages = [createMockMessage({ subject: longSubject })];
      render(<MailList messages={messages} />);

      expect(screen.getByTitle(longSubject)).toBeInTheDocument();
    });
  });
});
