/**
 * Tests for upload-storage (adj-203.1.3).
 *
 * The load-bearing security primitive for Commander screenshot sharing. It:
 *   - resolves ADJUTANT_UPLOAD_DIR (env or ~/.adjutant/uploads),
 *   - generates safe server-side `<uuid>.<ext>` names,
 *   - validates uploads by MIME allowlist + MAGIC-BYTE sniff (never trust the
 *     client's declared type) and a hard size cap,
 *   - writes files confined to the uploads dir (path-traversal-proof),
 *   - deletes files (confined to the uploads dir).
 *
 * Uses REAL byte buffers with real image magic bytes (adj-067 rule: real data
 * shapes, not hand-crafted objects) written into a real temp dir.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";

import {
  createUploadStorage,
  resolveUploadDir,
  sniffMime,
  MAX_UPLOAD_BYTES,
  ALLOWED_MIME_TYPES,
  type UploadStorage,
} from "../../src/services/upload-storage.js";

// --- real magic-byte fixtures -------------------------------------------------
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const GIF = Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.from([0x00, 0x01])]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "ascii"),
  Buffer.from([0x00, 0x01]),
]);
const NOT_IMAGE = Buffer.from("<html><body>hi</body></html>", "utf8");

let dir: string;
let storage: UploadStorage;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "adj-uploads-"));
  storage = createUploadStorage({ uploadDir: dir });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ============================================================================
// resolveUploadDir
// ============================================================================

describe("resolveUploadDir", () => {
  const KEY = "ADJUTANT_UPLOAD_DIR";
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env[KEY];
  });
  afterEach(() => {
    if (prev === undefined) delete process.env[KEY];
    else process.env[KEY] = prev;
  });

  it("should honor ADJUTANT_UPLOAD_DIR when set", () => {
    process.env[KEY] = "/var/data/adj-uploads";
    expect(resolveUploadDir()).toBe("/var/data/adj-uploads");
  });

  it("should default to ~/.adjutant/uploads when unset", () => {
    delete process.env[KEY];
    expect(resolveUploadDir()).toBe(join(homedir(), ".adjutant", "uploads"));
  });
});

// ============================================================================
// sniffMime — magic-byte detection
// ============================================================================

describe("sniffMime", () => {
  it("should detect each allowed image type from magic bytes", () => {
    expect(sniffMime(PNG)).toBe("image/png");
    expect(sniffMime(JPEG)).toBe("image/jpeg");
    expect(sniffMime(GIF)).toBe("image/gif");
    expect(sniffMime(WEBP)).toBe("image/webp");
  });

  it("should return null for non-image bytes", () => {
    expect(sniffMime(NOT_IMAGE)).toBeNull();
  });

  it("should return null for an empty/too-short buffer", () => {
    expect(sniffMime(Buffer.alloc(0))).toBeNull();
    expect(sniffMime(Buffer.from([0x89, 0x50]))).toBeNull();
  });

  it("should NOT misclassify a WEBP-less RIFF container", () => {
    const riffOnly = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(8)]);
    expect(sniffMime(riffOnly)).toBeNull();
  });
});

// ============================================================================
// generateStoredName
// ============================================================================

describe("UploadStorage.generateStoredName", () => {
  it("should produce a <uuid>.<ext> name for the given extension", () => {
    const name = storage.generateStoredName("png");
    expect(name).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/);
  });

  it("should produce a unique name on each call", () => {
    const a = storage.generateStoredName("jpg");
    const b = storage.generateStoredName("jpg");
    expect(a).not.toBe(b);
  });

  it("should reject a non-allowlisted / unsafe extension", () => {
    expect(() => storage.generateStoredName("php")).toThrow();
    expect(() => storage.generateStoredName("../x")).toThrow();
  });
});

// ============================================================================
// validate — allowlist + magic + size cap
// ============================================================================

describe("UploadStorage.validate", () => {
  it("should accept an allowed image and return its sniffed mime + ext", () => {
    const r = storage.validate(PNG);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mime).toBe("image/png");
      expect(r.ext).toBe("png");
    }
  });

  it("should reject a disallowed type (magic-byte sniff fails)", () => {
    const r = storage.validate(NOT_IMAGE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unsupported-type");
  });

  it("should reject when the declared mime disagrees with the sniffed bytes", () => {
    // client claims png but bytes are jpeg → mismatch (anti-spoofing)
    const r = storage.validate(JPEG, "image/png");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("mime-mismatch");
  });

  it("should accept when the declared mime matches the sniffed bytes", () => {
    const r = storage.validate(JPEG, "image/jpeg");
    expect(r.ok).toBe(true);
  });

  it("should reject an oversized buffer (> MAX_UPLOAD_BYTES)", () => {
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES + 1)]);
    const r = storage.validate(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("too-large");
  });

  it("should reject an empty buffer", () => {
    const r = storage.validate(Buffer.alloc(0));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("empty");
  });

  it("should expose the allowed mime set", () => {
    expect(ALLOWED_MIME_TYPES).toContain("image/png");
    expect(ALLOWED_MIME_TYPES).toContain("image/webp");
    expect(ALLOWED_MIME_TYPES).not.toContain("application/pdf");
  });
});

// ============================================================================
// write — traversal-proof, confined to uploadDir
// ============================================================================

describe("UploadStorage.write", () => {
  it("should write the buffer under the uploads dir and return an absolute path", () => {
    const name = storage.generateStoredName("png");
    const abs = storage.write(PNG, name);
    expect(abs).toBe(join(dir, name));
    expect(existsSync(abs)).toBe(true);
    expect(readFileSync(abs).equals(PNG)).toBe(true);
    expect(dirname(abs)).toBe(dir);
  });

  it("should reject a stored name containing path traversal", () => {
    expect(() => storage.write(PNG, "../escape.png")).toThrow();
    expect(() => storage.write(PNG, "sub/dir.png")).toThrow();
    expect(() => storage.write(PNG, "/abs/evil.png")).toThrow();
    // nothing escaped the dir
    expect(existsSync(join(dirname(dir), "escape.png"))).toBe(false);
  });

  it("should create the uploads dir if it does not yet exist", () => {
    const nested = join(dir, "nested", "deep");
    const s2 = createUploadStorage({ uploadDir: nested });
    const name = s2.generateStoredName("gif");
    const abs = s2.write(GIF, name);
    expect(existsSync(abs)).toBe(true);
  });
});

// ============================================================================
// delete — confined to uploadDir
// ============================================================================

describe("UploadStorage.delete", () => {
  it("should delete a file inside the uploads dir", () => {
    const name = storage.generateStoredName("png");
    const abs = storage.write(PNG, name);
    expect(existsSync(abs)).toBe(true);
    storage.delete(abs);
    expect(existsSync(abs)).toBe(false);
  });

  it("should refuse to delete a path outside the uploads dir", () => {
    const outside = join(tmpdir(), "victim-file.txt");
    writeFileSync(outside, "keep me");
    try {
      expect(() => storage.delete(outside)).toThrow();
      expect(existsSync(outside)).toBe(true);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("should be a no-op (not throw) when the file is already gone", () => {
    const name = storage.generateStoredName("png");
    const abs = join(dir, name);
    expect(() => storage.delete(abs)).not.toThrow();
  });
});
