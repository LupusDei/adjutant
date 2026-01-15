import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MailDetail } from '../../../src/components/mail/MailDetail';
import type { Message } from '../../../src/types';
import { useIsMobile } from '../../../src/hooks/useMediaQuery';

// Mock the useIsMobile hook
vi.mock('../../../src/hooks/useMediaQuery', () => ({
  useIsMobile: vi.fn(),
}));

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-123',
    from: 'mayor/',
    to: 'operator',
    subject: 'Test Message Subject',
    body: 'This is the message body.\n\nWith multiple paragraphs.',
    timestamp: '2026-01-11T10:30:00Z',
    read: false,
    priority: 2,
    type: 'notification',
    threadId: 'thread-1',
    pinned: false,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('MailDetail', () => {
  beforeEach(() => {
    // Default mock for useIsMobile to return false
    (useIsMobile as vi.Mock).mockReturnValue(false);
  });

  describe('loading state', () => {
    it('should show loading indicator when loading', () => {
      render(<MailDetail message={null} loading={true} />);
      expect(screen.getByText('LOADING MESSAGE...')).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('should show empty state when no message selected', () => {
      render(<MailDetail message={null} />);
      expect(screen.getByText('SELECT A MESSAGE TO VIEW')).toBeInTheDocument();
    });
  });

  describe('message display', () => {
    it('should display message subject', () => {
      const message = createMockMessage({ subject: 'Important Update' });
      render(<MailDetail message={message} />);
      expect(screen.getByText('Important Update')).toBeInTheDocument();
    });

    it('should display formatted sender', () => {
      const message = createMockMessage({ from: 'mayor/' });
      render(<MailDetail message={message} />);
      expect(screen.getByText('Mayor')).toBeInTheDocument();
    });

    it('should display formatted recipient', () => {
      const message = createMockMessage({ to: 'operator' });
      render(<MailDetail message={message} />);
      expect(screen.getByText('Operator')).toBeInTheDocument();
    });

    it('should display message body with line breaks preserved', () => {
      const message = createMockMessage({
        body: 'First line.\n\nSecond paragraph.',
      });
      render(<MailDetail message={message} />);
      expect(screen.getByText('First line.')).toBeInTheDocument();
      expect(screen.getByText('Second paragraph.')).toBeInTheDocument();
    });

    it('should display message ID', () => {
      const message = createMockMessage({ id: 'msg-abc-123' });
      render(<MailDetail message={message} />);
      expect(screen.getByText('msg-abc-123')).toBeInTheDocument();
    });

    it('should display message type badge', () => {
      const message = createMockMessage({ type: 'task' });
      render(<MailDetail message={message} />);
      expect(screen.getByText('[TASK]')).toBeInTheDocument();
    });

    it('should display read status', () => {
      const readMessage = createMockMessage({ read: true });
      const unreadMessage = createMockMessage({ read: false });

      const { rerender } = render(<MailDetail message={readMessage} />);
      expect(screen.getByText('● READ')).toBeInTheDocument();

      rerender(<MailDetail message={unreadMessage} />);
      expect(screen.getByText('○ UNREAD')).toBeInTheDocument();
    });
  });

  describe('priority display', () => {
    it('should display urgent priority', () => {
      const message = createMockMessage({ priority: 0 });
      render(<MailDetail message={message} />);
      expect(screen.getByText('!!! URGENT')).toBeInTheDocument();
    });

    it('should display high priority', () => {
      const message = createMockMessage({ priority: 1 });
      render(<MailDetail message={message} />);
      expect(screen.getByText('!! HIGH')).toBeInTheDocument();
    });

    it('should not display priority for normal messages', () => {
      const message = createMockMessage({ priority: 2 });
      render(<MailDetail message={message} />);
      expect(screen.queryByText(/URGENT|HIGH|LOW/)).not.toBeInTheDocument();
    });

    it('should display low priority', () => {
      const message = createMockMessage({ priority: 3 });
      render(<MailDetail message={message} />);
      expect(screen.getByText('▽ LOW')).toBeInTheDocument();
    });
  });

  describe('special indicators', () => {
    it('should show pinned indicator when message is pinned', () => {
      const message = createMockMessage({ pinned: true });
      render(<MailDetail message={message} />);
      expect(screen.getByText(/PINNED/)).toBeInTheDocument();
    });

    it('should show reply indicator when message is a reply', () => {
      const message = createMockMessage({ replyTo: 'original-msg-id' });
      render(<MailDetail message={message} />);
      expect(screen.getByText(/REPLY/)).toBeInTheDocument();
    });

    it('should display CC recipients when present', () => {
      const message = createMockMessage({ cc: ['witness/', 'deacon/'] });
      render(<MailDetail message={message} />);
      expect(screen.getByText('CC:')).toBeInTheDocument();
      expect(screen.getByText(/Witness.*Deacon/)).toBeInTheDocument();
    });
  });

  describe('close button', () => {
    beforeEach(() => {
      // Ensure useIsMobile returns true for these tests so the close button is rendered
      (useIsMobile as vi.Mock).mockReturnValue(true);
    });

    it('should show close button when onClose is provided', () => {
      const message = createMockMessage();
      render(<MailDetail message={message} onClose={() => {}} />);
      expect(screen.getByRole('button', { name: /close message/i })).toBeInTheDocument();
    });

    it('should not show close button when onClose is not provided', () => {
      const message = createMockMessage();
      render(<MailDetail message={message} />);
      expect(screen.queryByRole('button', { name: /close|back/i })).not.toBeInTheDocument();
    });

    it('should call onClose when close button is clicked', () => {
      const onClose = vi.fn();
      const message = createMockMessage();

      render(<MailDetail message={message} onClose={onClose} />);

      fireEvent.click(screen.getByRole('button', { name: /close message/i }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('accessibility', () => {
    it('should have article role with proper label', () => {
      const message = createMockMessage();
      render(<MailDetail message={message} />);
      expect(screen.getByRole('article', { name: /message details/i })).toBeInTheDocument();
    });
  });
});
