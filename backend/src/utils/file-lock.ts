// ============================================================================
// File Lock Utility - T011
// Simple file-based locking for concurrent playback safety
// ============================================================================

import { existsSync, writeFileSync, unlinkSync, readFileSync } from "fs";
import { unlink } from "fs/promises";

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base error for lock operations.
 */
export class LockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockError";
  }
}

/**
 * Error thrown when lock acquisition times out.
 */
export class LockTimeoutError extends LockError {
  constructor(filePath: string, timeout: number) {
    super(
      `Failed to acquire lock on "${filePath}" within ${timeout}ms timeout`
    );
    this.name = "LockTimeoutError";
  }
}

// ============================================================================
// Types
// ============================================================================

export interface Lock {
  /** Path to the locked file */
  filePath: string;
  /** Path to the lock file */
  lockFilePath: string;
  /** Whether the lock is currently held */
  acquired: boolean;
  /** Timestamp when lock was acquired */
  acquiredAt: number;
  /** Unique ID for this lock instance */
  lockId: string;
}

export interface AcquireLockOptions {
  /** Timeout in milliseconds (default: 5000) */
  timeout?: number;
  /** Retry interval in milliseconds (default: 50) */
  retryInterval?: number;
  /** Stale lock threshold in milliseconds (default: 30000) */
  staleThreshold?: number;
}

// ============================================================================
// Lock File Management
// ============================================================================

/**
 * Generate a unique lock ID.
 */
function generateLockId(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get the lock file path for a given file.
 */
function getLockFilePath(filePath: string): string {
  return `${filePath}.lock`;
}

/**
 * Read lock file contents.
 */
function readLockFile(lockFilePath: string): { lockId: string; timestamp: number } | null {
  try {
    if (!existsSync(lockFilePath)) {
      return null;
    }
    const content = readFileSync(lockFilePath, "utf-8");
    const parts = content.split(":");
    const lockId = parts[0];
    const timestampStr = parts[1];
    if (!lockId || !timestampStr) {
      return null;
    }
    return {
      lockId,
      timestamp: parseInt(timestampStr, 10),
    };
  } catch {
    return null;
  }
}

/**
 * Write lock file contents.
 */
function writeLockFile(lockFilePath: string, lockId: string): void {
  const content = `${lockId}:${Date.now()}`;
  writeFileSync(lockFilePath, content, { flag: "wx" });
}

/**
 * Check if a lock is stale (held too long, possibly from crashed process).
 */
function isLockStale(
  lockFilePath: string,
  staleThreshold: number
): boolean {
  const lockInfo = readLockFile(lockFilePath);
  if (!lockInfo) {
    return false;
  }
  return Date.now() - lockInfo.timestamp > staleThreshold;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Acquire a lock on a file.
 * Waits up to timeout milliseconds for the lock to become available.
 */
export async function acquireLock(
  filePath: string,
  options: AcquireLockOptions = {}
): Promise<Lock> {
  const {
    timeout = 5000,
    retryInterval = 50,
    staleThreshold = 30000,
  } = options;

  const lockFilePath = getLockFilePath(filePath);
  const lockId = generateLockId();
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      // Try to create lock file exclusively
      writeLockFile(lockFilePath, lockId);

      // Lock acquired successfully
      return {
        filePath,
        lockFilePath,
        acquired: true,
        acquiredAt: Date.now(),
        lockId,
      };
    } catch (error) {
      // Lock file already exists
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        // Check if lock is stale
        if (isLockStale(lockFilePath, staleThreshold)) {
          // Remove stale lock and try again
          try {
            unlinkSync(lockFilePath);
            continue;
          } catch {
            // Another process may have removed it
          }
        }

        // Wait and retry
        await new Promise((resolve) => setTimeout(resolve, retryInterval));
        continue;
      }

      // Some other error
      throw new LockError(`Failed to acquire lock: ${(error as Error).message}`);
    }
  }

  throw new LockTimeoutError(filePath, timeout);
}

/**
 * Release a lock.
 * Safe to call multiple times.
 */
export async function releaseLock(lock: Lock): Promise<void> {
  if (!lock.acquired) {
    return; // Already released
  }

  try {
    // Verify we still own the lock
    const lockInfo = readLockFile(lock.lockFilePath);
    if (lockInfo && lockInfo.lockId === lock.lockId) {
      await unlink(lock.lockFilePath);
    }
  } catch {
    // Lock file may have been removed by another process
  }

  lock.acquired = false;
}

/**
 * Check if a file is currently locked.
 */
export async function isLocked(filePath: string): Promise<boolean> {
  const lockFilePath = getLockFilePath(filePath);
  return existsSync(lockFilePath);
}

/**
 * Execute a callback with a lock held.
 * Ensures lock is released even if callback throws.
 */
export async function withLock<T>(
  filePath: string,
  callback: () => Promise<T>,
  options?: AcquireLockOptions
): Promise<T> {
  const lock = await acquireLock(filePath, options);

  try {
    return await callback();
  } finally {
    await releaseLock(lock);
  }
}

/**
 * Force release a lock (remove lock file).
 * Use with caution - only for cleanup/recovery.
 */
export async function forceReleaseLock(filePath: string): Promise<boolean> {
  const lockFilePath = getLockFilePath(filePath);

  try {
    if (existsSync(lockFilePath)) {
      await unlink(lockFilePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
