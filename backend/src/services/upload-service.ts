/**
 * UploadService (adj-203.2.1) — orchestration for Commander image uploads.
 *
 * The single business-logic seam between the HTTP layer (routes/uploads.ts) and
 * the two primitives it composes: upload-storage (validate + write the file) and
 * attachment-store (persist the row). Routes never touch the filesystem or DB
 * directly (layered architecture).
 *
 * Flow: validate(bytes) → write file under the uploads dir → insert an UNLINKED
 * attachment row → return the row's public metadata. Validation failures throw
 * {@link UploadValidationError} so the route can map them to a structured 4xx.
 */

import { basename } from "node:path";
import type { ReadStream } from "node:fs";

import type { UploadStorage, ValidationErrorCode } from "./upload-storage.js";
import type { AttachmentStore, MessageAttachment } from "./attachment-store.js";

/** Thrown when an upload fails validation. The route maps `.code` → a 400 body. */
export class UploadValidationError extends Error {
  readonly code: ValidationErrorCode;
  constructor(code: ValidationErrorCode, message: string) {
    super(message);
    this.name = "UploadValidationError";
    this.code = code;
  }
}

export interface UploadInput {
  buffer: Buffer;
  /** Original client filename (display only — sanitized to a basename). */
  filename?: string | undefined;
  /** Client-declared MIME type, cross-checked against the sniffed bytes. */
  declaredMime?: string | undefined;
}

/** Public upload metadata returned to the client (never the storage path). */
export interface UploadResult {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface UploadServiceDeps {
  storage: UploadStorage;
  attachmentStore: AttachmentStore;
}

/** Everything the serve route needs to stream a stored image. */
export interface ServeFile {
  mimeType: string;
  sizeBytes: number;
  filename: string;
  stream: ReadStream;
}

export interface UploadService {
  upload(input: UploadInput): UploadResult;
  getById(id: string): MessageAttachment | null;
  /**
   * Resolve an attachment id to a streamable file for `GET /api/uploads/:id`.
   * Returns null when the id is unknown OR the backing file is missing (both
   * map to a 404 — no existence leak between the two).
   */
  getFileForServe(id: string): ServeFile | null;
}

/** Reduce a client-supplied filename to a safe display basename. */
function safeDisplayName(filename: string | undefined, fallback: string): string {
  if (filename === undefined) return fallback;
  const base = basename(filename).replace(/\0/g, "").trim();
  // Reject empties and dotfiles-only that resolve to nothing useful.
  if (base.length === 0 || base === "." || base === "..") return fallback;
  return base;
}

export function createUploadService(deps: UploadServiceDeps): UploadService {
  const { storage, attachmentStore } = deps;

  return {
    upload(input: UploadInput): UploadResult {
      const validation = storage.validate(input.buffer, input.declaredMime);
      if (!validation.ok) {
        throw new UploadValidationError(validation.code, validation.message);
      }

      const storedName = storage.generateStoredName(validation.ext);
      const storagePath = storage.write(input.buffer, storedName);
      const filename = safeDisplayName(input.filename, storedName);

      const attachment = attachmentStore.createAttachment({
        kind: "image",
        storagePath,
        filename,
        mimeType: validation.mime,
        sizeBytes: input.buffer.length,
      });

      return {
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
      };
    },

    getById(id: string): MessageAttachment | null {
      return attachmentStore.getById(id);
    },

    getFileForServe(id: string): ServeFile | null {
      const attachment = attachmentStore.getById(id);
      if (attachment === null) return null;
      if (!storage.exists(attachment.storagePath)) return null;
      return {
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        filename: attachment.filename,
        stream: storage.openReadStream(attachment.storagePath),
      };
    },
  };
}
