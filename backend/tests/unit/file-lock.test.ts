// ============================================================================
// File Lock Tests - T012
// Unit tests for file locking utility
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DIR = join(tmpdir(), `file-lock-test-${Date.now()}`);

import {
  acquireLock,
  releaseLock,
  isLocked,
  withLock,
  LockError,
  LockTimeoutError,
} from "../../src/utils/file-lock.js";

describe("file-lock", () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    try {
      if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("acquireLock", () => {
    it("should acquire lock on unlocked file", async () => {
      const filePath = join(TEST_DIR, "test-file.mp3");
      writeFileSync(filePath, "audio-content");

      const lock = await acquireLock(filePath);

      expect(lock).toBeDefined();
      expect(lock.filePath).toBe(filePath);
      expect(lock.acquired).toBe(true);

      await releaseLock(lock);
    });

    it("should create lock file", async () => {
      const filePath = join(TEST_DIR, "lockable.mp3");
      writeFileSync(filePath, "content");

      const lock = await acquireLock(filePath);
      const lockFilePath = `${filePath}.lock`;

      expect(existsSync(lockFilePath)).toBe(true);

      await releaseLock(lock);
    });

    it("should fail to acquire lock on already locked file", async () => {
      const filePath = join(TEST_DIR, "already-locked.mp3");
      writeFileSync(filePath, "content");

      const lock1 = await acquireLock(filePath);

      await expect(acquireLock(filePath, { timeout: 100 })).rejects.toThrow(
        LockTimeoutError
      );

      await releaseLock(lock1);
    });

    it("should wait and acquire lock when released", async () => {
      const filePath = join(TEST_DIR, "wait-for-lock.mp3");
      writeFileSync(filePath, "content");

      const lock1 = await acquireLock(filePath);

      // Release after 50ms
      setTimeout(() => releaseLock(lock1), 50);

      // Should eventually acquire
      const lock2 = await acquireLock(filePath, { timeout: 500 });

      expect(lock2.acquired).toBe(true);

      await releaseLock(lock2);
    });

    it("should respect retry interval", async () => {
      const filePath = join(TEST_DIR, "retry-test.mp3");
      writeFileSync(filePath, "content");

      const lock1 = await acquireLock(filePath);

      const startTime = Date.now();

      // This should timeout after trying with retries
      await expect(
        acquireLock(filePath, { timeout: 200, retryInterval: 50 })
      ).rejects.toThrow(LockTimeoutError);

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(180); // Allow some timing slack

      await releaseLock(lock1);
    });
  });

  describe("releaseLock", () => {
    it("should release lock and remove lock file", async () => {
      const filePath = join(TEST_DIR, "release-test.mp3");
      writeFileSync(filePath, "content");

      const lock = await acquireLock(filePath);
      const lockFilePath = `${filePath}.lock`;

      expect(existsSync(lockFilePath)).toBe(true);

      await releaseLock(lock);

      expect(existsSync(lockFilePath)).toBe(false);
    });

    it("should mark lock as released", async () => {
      const filePath = join(TEST_DIR, "mark-released.mp3");
      writeFileSync(filePath, "content");

      const lock = await acquireLock(filePath);
      await releaseLock(lock);

      expect(lock.acquired).toBe(false);
    });

    it("should be safe to release already released lock", async () => {
      const filePath = join(TEST_DIR, "double-release.mp3");
      writeFileSync(filePath, "content");

      const lock = await acquireLock(filePath);
      await releaseLock(lock);

      // Should not throw
      await expect(releaseLock(lock)).resolves.not.toThrow();
    });
  });

  describe("isLocked", () => {
    it("should return false for unlocked file", async () => {
      const filePath = join(TEST_DIR, "unlocked.mp3");
      writeFileSync(filePath, "content");

      const locked = await isLocked(filePath);

      expect(locked).toBe(false);
    });

    it("should return true for locked file", async () => {
      const filePath = join(TEST_DIR, "is-locked.mp3");
      writeFileSync(filePath, "content");

      const lock = await acquireLock(filePath);

      const locked = await isLocked(filePath);

      expect(locked).toBe(true);

      await releaseLock(lock);
    });

    it("should return false after lock released", async () => {
      const filePath = join(TEST_DIR, "was-locked.mp3");
      writeFileSync(filePath, "content");

      const lock = await acquireLock(filePath);
      await releaseLock(lock);

      const locked = await isLocked(filePath);

      expect(locked).toBe(false);
    });
  });

  describe("withLock", () => {
    it("should execute callback with lock held", async () => {
      const filePath = join(TEST_DIR, "with-lock.mp3");
      writeFileSync(filePath, "content");

      let callbackExecuted = false;

      await withLock(filePath, async () => {
        callbackExecuted = true;
        expect(await isLocked(filePath)).toBe(true);
      });

      expect(callbackExecuted).toBe(true);
    });

    it("should release lock after callback completes", async () => {
      const filePath = join(TEST_DIR, "auto-release.mp3");
      writeFileSync(filePath, "content");

      await withLock(filePath, async () => {
        // Do something
      });

      const locked = await isLocked(filePath);
      expect(locked).toBe(false);
    });

    it("should release lock even if callback throws", async () => {
      const filePath = join(TEST_DIR, "error-release.mp3");
      writeFileSync(filePath, "content");

      await expect(
        withLock(filePath, async () => {
          throw new Error("Callback error");
        })
      ).rejects.toThrow("Callback error");

      const locked = await isLocked(filePath);
      expect(locked).toBe(false);
    });

    it("should return callback result", async () => {
      const filePath = join(TEST_DIR, "return-value.mp3");
      writeFileSync(filePath, "content");

      const result = await withLock(filePath, async () => {
        return "success";
      });

      expect(result).toBe("success");
    });

    it("should prevent concurrent access", async () => {
      const filePath = join(TEST_DIR, "concurrent.mp3");
      writeFileSync(filePath, "content");

      const results: number[] = [];

      // Start two operations that should be serialized
      const op1 = withLock(filePath, async () => {
        results.push(1);
        await new Promise((r) => setTimeout(r, 50));
        results.push(2);
        return "op1";
      });

      const op2 = withLock(filePath, async () => {
        results.push(3);
        await new Promise((r) => setTimeout(r, 50));
        results.push(4);
        return "op2";
      });

      await Promise.all([op1, op2]);

      // Operations should not interleave
      // Either [1, 2, 3, 4] or [3, 4, 1, 2]
      expect(
        (results[0] === 1 && results[1] === 2) ||
          (results[0] === 3 && results[1] === 4)
      ).toBe(true);
    });
  });

  describe("LockError", () => {
    it("should have correct name and message", () => {
      const error = new LockError("Test lock error");

      expect(error.name).toBe("LockError");
      expect(error.message).toBe("Test lock error");
    });
  });

  describe("LockTimeoutError", () => {
    it("should extend LockError", () => {
      const error = new LockTimeoutError("/path/to/file", 1000);

      expect(error).toBeInstanceOf(LockError);
      expect(error.name).toBe("LockTimeoutError");
      expect(error.message).toContain("/path/to/file");
      expect(error.message).toContain("1000");
    });
  });
});
