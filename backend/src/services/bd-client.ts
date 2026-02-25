import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { logError, logInfo, logWarn } from "../utils/index.js";

// =============================================================================
// Semaphore for serializing bd access (prevents concurrent SQLite SIGSEGV)
// =============================================================================

/**
 * Simple counting semaphore that limits concurrent bd process executions.
 * Dolt's embedded SQLite can SIGSEGV when accessed concurrently, so we
 * serialize all bd commands through this gate.
 */
class BdSemaphore {
  private queue: (() => void)[] = [];
  private running = 0;

  constructor(private readonly maxConcurrency: number = 1) {}

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrency) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      // Don't decrement running — we're handing the slot to the next waiter
      next();
    } else {
      this.running--;
    }
  }
}

let bdSemaphore = new BdSemaphore(1);

/**
 * Reset the semaphore — only used in tests to avoid cross-test pollution.
 */
export function _resetBdSemaphore(): void {
  bdSemaphore = new BdSemaphore(1);
}

export interface BeadsIssue {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  issue_type: string;
  created_at: string;
  updated_at?: string;
  closed_at?: string | null;
  assignee?: string | null;
  labels?: string[];
  hook_bead?: string | null;
  role_bead?: string | null;
  agent_state?: string | null;
  pinned?: boolean;
  wisp?: boolean;
  dependency_count?: number;
  dependent_count?: number;
  dependencies?: { issue_id: string; depends_on_id: string; type: string }[];
}

export interface BdResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    stderr?: string;
  };
  exitCode: number;
}

export interface BdExecOptions {
  cwd?: string;
  beadsDir?: string;
  timeout?: number;
  parseJson?: boolean;
  env?: Record<string, string | undefined>;
}

const DEFAULT_TIMEOUT = 30000;
const REDIRECT_DEPTH = 3;

/**
 * Strips the bead prefix from an ID for use with bd show.
 * bd show expects short IDs (e.g., "vts8") not full IDs (e.g., "hq-vts8").
 * @param fullId Full bead ID like "hq-vts8" or "hq-cv-hfove"
 * @returns Short ID like "vts8" or "cv-hfove"
 */
export function stripBeadPrefix(fullId: string): string {
  // Known prefixes are 2-5 alphanumeric chars followed by hyphen (hq-, gt-, zt20-, etc.)
  // Pattern: <prefix>-<rest> where prefix is 2-5 alphanumeric chars
  const match = fullId.match(/^[a-z0-9]{2,5}-(.+)$/i);
  return match?.[1] ?? fullId;
}

function resolveBeadsDirWithDepth(beadsDir: string, depth: number): string {
  if (depth <= 0) return beadsDir;
  const redirectPath = join(beadsDir, "redirect");
  if (!existsSync(redirectPath)) return beadsDir;
  const target = readFileSync(redirectPath, "utf8").trim();
  if (!target) return beadsDir;
  const workDir = dirname(beadsDir);
  const resolved = resolve(workDir, target);
  if (resolved === beadsDir) return beadsDir;
  return resolveBeadsDirWithDepth(resolved, depth - 1);
}

export function resolveBeadsDir(workDir: string): string {
  const beadsDir = join(workDir, ".beads");
  const redirectPath = join(beadsDir, "redirect");
  if (!existsSync(redirectPath)) return beadsDir;
  const target = readFileSync(redirectPath, "utf8").trim();
  if (!target) return beadsDir;
  const resolved = resolve(workDir, target);
  if (resolved === beadsDir) return beadsDir;
  return resolveBeadsDirWithDepth(resolved, REDIRECT_DEPTH);
}

/**
 * Detects Go runtime panics in stderr output.
 * Returns true if the stderr contains telltale signs of a Go panic/crash.
 */
function isGoPanic(stderr: string): boolean {
  return (
    stderr.includes("goroutine ") ||
    stderr.includes("runtime error:") ||
    stderr.includes("nil pointer dereference") ||
    stderr.includes("panic:") ||
    stderr.includes("SIGSEGV") ||
    stderr.includes("signal SIGSEGV")
  );
}

/**
 * Produces a user-friendly error message from bd stderr, truncating
 * long Go panic stacktraces. Returns at most the first 500 chars.
 */
function sanitizeBdError(stderr: string, exitCode: number): string {
  if (!stderr) return `bd exited with code ${exitCode}`;

  if (isGoPanic(stderr)) {
    // Extract just the panic reason line, not the full stacktrace
    const lines = stderr.split("\n");
    const panicLine = lines.find(
      (l) => l.startsWith("panic:") || l.includes("runtime error:") || l.includes("nil pointer dereference")
    );
    const reason = panicLine?.trim() ?? "Go runtime panic";
    return `bd crashed: ${reason}`;
  }

  // Non-panic errors: return first 500 chars
  return stderr.substring(0, 500);
}

export async function execBd<T = unknown>(
  args: string[],
  options: BdExecOptions = {}
): Promise<BdResult<T>> {
  const { cwd = process.cwd(), timeout = DEFAULT_TIMEOUT, parseJson = true, env } = options;
  const beadsDir = options.beadsDir ?? resolveBeadsDir(cwd);
  const fullArgs = ["--allow-stale", ...args];
  const startedAt = Date.now();
  logInfo("bd exec start", { args: fullArgs });

  // Serialize bd access to prevent concurrent SQLite access (SIGSEGV)
  await bdSemaphore.acquire();

  try {
    return await new Promise<BdResult<T>>((resolveResult) => {
      const child = spawn("bd", fullArgs, {
        cwd,
        env: { ...process.env, ...env, BEADS_DIR: beadsDir },
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const timeoutMs = Math.max(0, timeout);
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const finish = (result: BdResult<T>) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        resolveResult(result);
      };

      if (timeoutMs) {
        timeoutId = setTimeout(() => {
          try {
            child.kill();
          } catch {
            // Ignore kill errors on timeout.
          }
          logWarn("bd exec timed out", {
            args: fullArgs,
            durationMs: Date.now() - startedAt,
          });
          finish({
            success: false,
            error: { code: "TIMEOUT", message: `Command timed out after ${timeoutMs}ms` },
            exitCode: -1,
          });
        }, timeoutMs);
      }

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("error", (err) => {
        logError("bd exec spawn error", {
          args: fullArgs,
          message: err.message,
          durationMs: Date.now() - startedAt,
        });
        finish({
          success: false,
          error: { code: "SPAWN_ERROR", message: err.message },
          exitCode: -1,
        });
      });

      child.on("close", (code) => {
        if (settled) return;
        const exitCode = code ?? 0;
        const stderrTrimmed = stderr.trim();
        const stdoutTrimmed = stdout.trim();

        // Failure if:
        // 1. Non-zero exit code
        // 2. Or: Both stdout and stderr are empty (nothing happened)
        // 3. Or: stdout is empty but stderr has content (pure error)
        if (exitCode !== 0 || (stdoutTrimmed === "" && stderrTrimmed !== "")) {
          // Detect Go panics for clearer error reporting
          const isPanic = isGoPanic(stderrTrimmed);
          const errorCode = isPanic ? "BD_PANIC" : "COMMAND_FAILED";
          const errorMessage = sanitizeBdError(stderrTrimmed, exitCode);

          logError("bd exec failed", {
            args: fullArgs,
            exitCode,
            durationMs: Date.now() - startedAt,
            message: errorMessage,
            ...(isPanic ? { isPanic: true } : {}),
          });
          finish({
            success: false,
            error: {
              code: errorCode,
              message: errorMessage,
              ...(stderrTrimmed ? { stderr: stderrTrimmed.substring(0, 2000) } : {}),
            },
            exitCode,
          });
          return;
        }

        if (parseJson && stdoutTrimmed) {
          try {
            const data = JSON.parse(stdoutTrimmed) as T;
            const meta: Record<string, unknown> = {
              args: fullArgs,
              exitCode,
              durationMs: Date.now() - startedAt,
            };
            if (Array.isArray(data)) meta["count"] = data.length;
            logInfo("bd exec success", meta);
            finish({ success: true, data, exitCode });
          } catch {
            logError("bd exec parse error", {
              args: fullArgs,
              exitCode,
              durationMs: Date.now() - startedAt,
            });
            finish({
              success: false,
              error: {
                code: "PARSE_ERROR",
                message: "Failed to parse JSON output",
                stderr: stdoutTrimmed.substring(0, 500),
              },
              exitCode,
            });
          }
          return;
        }

        logInfo("bd exec success", {
          args: fullArgs,
          exitCode,
          durationMs: Date.now() - startedAt,
        });
        finish({
          success: true,
          data: (parseJson ? undefined : stdoutTrimmed) as T,
          exitCode,
        });
      });
    });
  } finally {
    bdSemaphore.release();
  }
}
