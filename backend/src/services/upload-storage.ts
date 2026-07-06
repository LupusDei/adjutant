/**
 * upload-storage (adj-203.1.3) — the load-bearing security primitive for
 * Commander screenshot sharing.
 *
 * Responsibilities (and ONLY these — no DB, no HTTP):
 *   - resolve the uploads directory (ADJUTANT_UPLOAD_DIR or ~/.adjutant/uploads),
 *   - generate safe, server-side `<uuid>.<ext>` names,
 *   - validate an upload by MIME ALLOWLIST + MAGIC-BYTE sniff (never trust the
 *     client-declared content type) and a hard size cap,
 *   - write files CONFINED to the uploads dir (path-traversal-proof),
 *   - delete files confined to the uploads dir.
 *
 * The stored absolute path is what the tmux-injection path (US2) hands to the
 * target agent's Claude, and what `GET /api/uploads/:id` streams to the UI — so
 * this boundary must be strict.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard per-file size cap: 10 MB. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Allowlisted image MIME types (MVP). */
export const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

/** Canonical file extension per allowed MIME type. */
const MIME_TO_EXT: Record<AllowedMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Extensions we will ever emit — the only names generateStoredName accepts. */
const ALLOWED_EXTS = new Set(Object.values(MIME_TO_EXT));

// ---------------------------------------------------------------------------
// Directory resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the uploads directory: `ADJUTANT_UPLOAD_DIR` if set (and non-empty),
 * otherwise `~/.adjutant/uploads`.
 */
export function resolveUploadDir(): string {
  const fromEnv = process.env["ADJUTANT_UPLOAD_DIR"];
  if (fromEnv !== undefined && fromEnv.trim().length > 0) return fromEnv;
  return join(homedir(), ".adjutant", "uploads");
}

// ---------------------------------------------------------------------------
// Magic-byte sniffing
// ---------------------------------------------------------------------------

/**
 * Detect an allowed image type from its leading magic bytes. Returns the MIME
 * string, or null when the bytes do not match any allowed image signature.
 * Never trusts a client-declared content type.
 */
export function sniffMime(buffer: Buffer): AllowedMime | null {
  if (buffer.length < 12) {
    // WEBP needs 12 bytes to confirm; the others need ≤8. Still allow the
    // shorter signatures for buffers ≥ their own length.
    if (buffer.length >= 8 && hasPngSignature(buffer)) return "image/png";
    if (buffer.length >= 3 && hasJpegSignature(buffer)) return "image/jpeg";
    if (buffer.length >= 6 && hasGifSignature(buffer)) return "image/gif";
    return null;
  }
  if (hasPngSignature(buffer)) return "image/png";
  if (hasJpegSignature(buffer)) return "image/jpeg";
  if (hasGifSignature(buffer)) return "image/gif";
  if (hasWebpSignature(buffer)) return "image/webp";
  return null;
}

function hasPngSignature(b: Buffer): boolean {
  // 89 50 4E 47 0D 0A 1A 0A
  return (
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  );
}

function hasJpegSignature(b: Buffer): boolean {
  // FF D8 FF
  return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function hasGifSignature(b: Buffer): boolean {
  // "GIF87a" or "GIF89a"
  return b.subarray(0, 4).toString("ascii") === "GIF8";
}

function hasWebpSignature(b: Buffer): boolean {
  // "RIFF" .... "WEBP"
  return b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP";
}

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export type ValidationErrorCode = "empty" | "too-large" | "unsupported-type" | "mime-mismatch";

export type ValidationResult =
  | { ok: true; mime: AllowedMime; ext: string }
  | { ok: false; code: ValidationErrorCode; message: string };

// ---------------------------------------------------------------------------
// Storage factory
// ---------------------------------------------------------------------------

export interface UploadStorage {
  /** Absolute uploads directory this storage writes to. */
  readonly uploadDir: string;
  /** Ensure the uploads directory exists (idempotent). */
  ensureDir(): void;
  /** Generate a safe `<uuid>.<ext>` name. Throws on a non-allowlisted extension. */
  generateStoredName(ext: string): string;
  /** Validate raw bytes by size + magic-byte allowlist (+ optional declared-mime cross-check). */
  validate(buffer: Buffer, declaredMime?: string): ValidationResult;
  /** Write bytes to `<uploadDir>/<storedName>` (traversal-proof). Returns the absolute path. */
  write(buffer: Buffer, storedName: string): string;
  /** Delete a file — refuses any path outside the uploads dir; no-op if already gone. */
  delete(storagePath: string): void;
}

export interface CreateUploadStorageOptions {
  /** Override the uploads dir (tests / DI). Defaults to {@link resolveUploadDir}. */
  uploadDir?: string;
  /** Override the size cap (tests). Defaults to {@link MAX_UPLOAD_BYTES}. */
  maxBytes?: number;
}

export function createUploadStorage(opts: CreateUploadStorageOptions = {}): UploadStorage {
  const uploadDir = resolve(opts.uploadDir ?? resolveUploadDir());
  const maxBytes = opts.maxBytes ?? MAX_UPLOAD_BYTES;

  function ensureDir(): void {
    if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
  }

  /** Resolve a stored name to an absolute path, refusing anything outside uploadDir. */
  function safeResolve(storedName: string): string {
    if (
      storedName.length === 0 ||
      storedName.includes("/") ||
      storedName.includes("\\") ||
      storedName.includes("\0") ||
      storedName === "." ||
      storedName === ".." ||
      storedName.includes("..")
    ) {
      throw new Error(`Unsafe upload name: ${JSON.stringify(storedName)}`);
    }
    const abs = resolve(uploadDir, storedName);
    // Confinement check: abs must live directly under uploadDir.
    if (abs !== join(uploadDir, storedName) || !abs.startsWith(uploadDir + sep)) {
      throw new Error(`Path escapes uploads dir: ${JSON.stringify(storedName)}`);
    }
    return abs;
  }

  return {
    uploadDir,
    ensureDir,

    generateStoredName(ext: string): string {
      const clean = ext.toLowerCase().replace(/^\./, "");
      if (!ALLOWED_EXTS.has(clean)) {
        throw new Error(`Extension not allowed: ${JSON.stringify(ext)}`);
      }
      return `${randomUUID()}.${clean}`;
    },

    validate(buffer: Buffer, declaredMime?: string): ValidationResult {
      if (buffer.length === 0) {
        return { ok: false, code: "empty", message: "Empty upload" };
      }
      if (buffer.length > maxBytes) {
        return {
          ok: false,
          code: "too-large",
          message: `Upload exceeds ${maxBytes} bytes`,
        };
      }
      const mime = sniffMime(buffer);
      if (mime === null) {
        return {
          ok: false,
          code: "unsupported-type",
          message: "Unsupported or unrecognized image type",
        };
      }
      if (declaredMime !== undefined && declaredMime.trim().length > 0 && declaredMime !== mime) {
        return {
          ok: false,
          code: "mime-mismatch",
          message: `Declared type ${declaredMime} does not match file contents (${mime})`,
        };
      }
      return { ok: true, mime, ext: MIME_TO_EXT[mime] };
    },

    write(buffer: Buffer, storedName: string): string {
      const abs = safeResolve(storedName);
      ensureDir();
      // wx flag would reject an existing file; uuid names collide with ~0 prob,
      // but writeFileSync default (overwrite) is fine and keeps this idempotent.
      writeFileSync(abs, buffer);
      return abs;
    },

    delete(storagePath: string): void {
      const abs = resolve(storagePath);
      if (abs !== uploadDir && !abs.startsWith(uploadDir + sep)) {
        throw new Error(`Refusing to delete outside uploads dir: ${JSON.stringify(storagePath)}`);
      }
      try {
        unlinkSync(abs);
      } catch (err) {
        // Already gone → no-op. Re-throw anything else (e.g. EACCES).
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    },
  };
}
