/**
 * MessageAttachments — inline image thumbnails for a chat message (adj-203).
 *
 * The serve endpoint `GET /api/uploads/:id` is behind `apiKeyAuth`, so a bare
 * `<img src="/api/uploads/:id">` can't carry the API key and would 401. Each
 * thumbnail is therefore fetched through the authenticated api client
 * (`api.uploads.fetchObjectUrl`) into a blob object URL, which is set as the
 * `<img src>` and revoked on unmount.
 *
 * The thumbnail frame is a fixed-size box rendered immediately (before the
 * async fetch resolves) so the message bubble reserves space and does not
 * reflow / shift when the image arrives (CLS).
 *
 * Clicking a thumbnail opens a full-image lightbox (a modal dialog reusing the
 * same object URL — the thumbnail is just the full image constrained by CSS).
 */

import React, { useEffect, useState, useCallback } from "react";

import type { MessageAttachment } from "../../types";
import { api } from "../../services/api";

/** True when the attachment is an image we know how to render inline. */
function isImageAttachment(att: MessageAttachment): boolean {
  return att.kind === "image" || att.mimeType.startsWith("image/");
}

/**
 * Fetch an uploaded image with auth and expose its blob object URL, revoking it
 * on unmount / id change. `error` is set when the image can't be loaded.
 */
function useAuthedImage(id: string): { src: string | null; error: boolean } {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setSrc(null);
    setError(false);

    api.uploads
      .fetchObjectUrl(id)
      .then((url) => {
        if (cancelled) {
          // Resolved after unmount — revoke immediately to avoid a leak.
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  return { src, error };
}

interface AttachmentThumbnailProps {
  attachment: MessageAttachment;
  onOpen: (src: string) => void;
}

/**
 * A single thumbnail. The frame renders immediately (reserving space); the
 * image fades in once its authenticated blob URL resolves.
 */
function AttachmentThumbnail({ attachment, onOpen }: AttachmentThumbnailProps): React.ReactElement {
  const { src, error } = useAuthedImage(attachment.id);

  return (
    <button
      type="button"
      className="chat-attachment-thumb"
      onClick={() => { if (src) onOpen(src); }}
      disabled={!src}
      aria-label={`View ${attachment.filename}`}
      title={attachment.filename}
    >
      {error ? (
        <span className="chat-attachment-thumb-error" aria-hidden="true">IMG?</span>
      ) : src ? (
        <img src={src} alt={attachment.filename} className="chat-attachment-thumb-img" loading="lazy" />
      ) : (
        <span className="chat-attachment-thumb-loading" aria-hidden="true" />
      )}
    </button>
  );
}

interface LightboxProps {
  src: string;
  filename: string;
  onClose: () => void;
}

/** Full-image modal overlay. Closes on backdrop click, the button, or Escape. */
function Lightbox({ src, filename, onClose }: LightboxProps): React.ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  return (
    <div
      className="chat-attachment-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Full image: ${filename}`}
      onClick={onClose}
    >
      <button type="button" className="chat-attachment-lightbox-close" aria-label="Close image" onClick={onClose}>
        x
      </button>
      <img
        src={src}
        alt={filename}
        className="chat-attachment-lightbox-img"
        onClick={(e) => { e.stopPropagation(); }}
      />
    </div>
  );
}

export interface MessageAttachmentsProps {
  attachments: MessageAttachment[] | undefined;
}

/**
 * Render the image attachments of a message as inline thumbnails with a
 * click-to-open lightbox. Renders nothing when there are no image attachments.
 */
export function MessageAttachments({ attachments }: MessageAttachmentsProps): React.ReactElement | null {
  const [lightbox, setLightbox] = useState<{ src: string; filename: string } | null>(null);

  const images = (attachments ?? []).filter(isImageAttachment);

  const openLightbox = useCallback(
    (att: MessageAttachment) => (src: string) => { setLightbox({ src, filename: att.filename }); },
    [],
  );
  const closeLightbox = useCallback(() => { setLightbox(null); }, []);

  if (images.length === 0) return null;

  return (
    <div className="chat-attachments">
      {images.map((att) => (
        <AttachmentThumbnail key={att.id} attachment={att} onOpen={openLightbox(att)} />
      ))}
      {lightbox && (
        <Lightbox src={lightbox.src} filename={lightbox.filename} onClose={closeLightbox} />
      )}
    </div>
  );
}

export default MessageAttachments;
