/**
 * AnnouncementBanner - Displays real-time announcements from WebSocket.
 *
 * Subscribes to announcement-type messages and shows them as toast banners
 * in the CRT aesthetic. Auto-dismisses after 10 seconds or on user click.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

import { useCommunication, type IncomingChatMessage } from '../../contexts/CommunicationContext';

interface Announcement {
  id: string;
  body: string;
  announcementType: string;
  timestamp: string;
}

interface IncomingWithMetadata extends IncomingChatMessage {
  metadata?: {
    type?: string;
    announcementType?: string;
  };
}

const AUTO_DISMISS_MS = 10_000;

const TYPE_LABELS: Record<string, string> = {
  completion: 'COMPLETE',
  blocker: 'BLOCKER',
  question: 'QUESTION',
};

const TYPE_CLASSES: Record<string, string> = {
  completion: 'announcement-completion',
  blocker: 'announcement-blocker',
  question: 'announcement-question',
};

export const AnnouncementBanner: React.FC = () => {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { subscribe } = useCommunication();

  const dismiss = useCallback(() => {
    setAnnouncement(null);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribe((incoming: IncomingChatMessage) => {
      const msg = incoming as IncomingWithMetadata;
      const meta = msg.metadata;
      if (meta?.type !== 'announcement') return;

      const ann: Announcement = {
        id: msg.id,
        body: msg.body,
        announcementType: meta.announcementType ?? 'info',
        timestamp: msg.timestamp,
      };

      setAnnouncement(ann);

      // Auto-dismiss after 10 seconds
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setAnnouncement(null);
        timerRef.current = null;
      }, AUTO_DISMISS_MS);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [subscribe]);

  if (!announcement) return null;

  const typeLabel = TYPE_LABELS[announcement.announcementType] ?? 'ALERT';
  const typeClass = TYPE_CLASSES[announcement.announcementType] ?? 'announcement-info';

  return (
    <div className={`announcement-banner ${typeClass}`} role="status">
      <span className="announcement-type">{typeLabel}</span>
      <span className="announcement-body">{announcement.body}</span>
      <button
        type="button"
        className="announcement-dismiss"
        onClick={dismiss}
        aria-label="Dismiss announcement"
      >
        x
      </button>
    </div>
  );
};

export default AnnouncementBanner;
