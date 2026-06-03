import { spawn } from "child_process";
import { existsSync, readFileSync, readdirSync, unlinkSync } from "fs";
import { tmpdir } from "os";
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

  constructor(private readonly maxConcurrency = 1) {}

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
  const match = /^[a-z0-9]{2,5}-(.+)$/i.exec(fullId);
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
 * Strips Dolt informational messages from stderr that are not actual errors.
 * These appear when bd auto-cleans orphaned dolt sql-server processes.
 */
function stripDoltInfoMessages(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => !(/^Info:\s+cleaned up \d+ orphaned dolt/.exec(line)))
    .join("\n")
    .trim();
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

/**
 * Run a SINGLE `bd` attempt (the primitive). Spawns one `bd` subprocess,
 * serialized through the semaphore, and resolves with a structured result. This
 * is the lowest layer — it does NOT reconnect or retry. The resilient,
 * reconnecting wrapper is {@link execBd} (which delegates here as its `run`
 * seam). Tests that need to assert exact single-spawn behaviour target this.
 */
export async function execBdOnce<T = unknown>(
  args: string[],
  options: BdExecOptions = {}
): Promise<BdResult<T>> {
  const { cwd = process.cwd(), timeout = DEFAULT_TIMEOUT, parseJson = true, env } = options;
  const beadsDir = options.beadsDir ?? resolveBeadsDir(cwd);
  const fullArgs = [...args];
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
        const stderrTrimmed = stripDoltInfoMessages(stderr);
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

/**
 * Run a `bd` command — the standard backend entry point. As of adj-182.2.4 this
 * is RESILIENT: it transparently reconnects on a Dolt connection blip
 * (server-down / open circuit breaker / refused dial) by re-reading the pinned
 * endpoint and retrying with bounded backoff, then resets the in-process breaker
 * on success so the backend recovers WITHOUT a process restart. For a logic error
 * (bead not found, bad args) it returns immediately — no wasted retries.
 *
 * The call surface is unchanged from the original single-attempt client, so every
 * existing caller gains resilience with no edit. {@link execBdOnce} is the
 * single-attempt primitive underneath (used as the `run` seam here and targeted
 * directly by tests that assert exact spawn behaviour).
 */
export async function execBd<T = unknown>(
  args: string[],
  options: BdExecOptions = {}
): Promise<BdResult<T>> {
  return execBdWithReconnect(args, options, productionReconnectSeams()) as Promise<BdResult<T>>;
}

// =============================================================================
// Reconnecting Dolt endpoint (adj-182.2.4)
// =============================================================================
//
// THE load-bearing resilience fix. Previously the backend bd-client took its Dolt
// endpoint from `process.env.BEADS_DOLT_SERVER_PORT` at process boot and never
// reconnected. When the pinned port churned (macOS sleep/crash), the per-port
// circuit breaker INSIDE `bd` (a `/tmp/beads-dolt-circuit-<port>.json` file)
// stayed open forever against the dead cached port — so the backend failed fast
// while a healthy server ran on a different port, wedging every agent until a
// manual restart.
//
// The fix: on a CONNECTION failure (not a logic error like bead-not-found),
// RE-READ the pinned endpoint from the canonical sources, clear the stale per-port
// circuit file so `bd` stops failing fast on the dead port, and retry with bounded
// exponential backoff. On a successful reconnect we RESET the in-process
// connection state so subsequent calls start clean — recovery WITHOUT a process
// restart.
//
// SAFETY: this layer ONLY makes the existing client resilient against endpoint
// blips. It does NOT start/stop/kill any dolt server and does NOT adopt the
// supervisor or perform a cutover (that is adj-182.2.5, gated). All external
// effects are injected SEAMS so the core is trivially unit-testable.

/**
 * The pinned-endpoint resolution sources, in priority order. Each returns the
 * port or null when that source has no value. Injected as seams for tests.
 */
export interface EndpointReaders {
  /** Read `BEADS_DOLT_SERVER_PORT` from the process env. */
  readEnvPort: () => number | null;
  /** Read `dolt_server_port` from `<beadsDir>/metadata.json`. */
  readMetadataPort: (beadsDir: string) => number | null;
  /** Read the port persisted in `<beadsDir>/dolt-server.port`. */
  readPortFile: (beadsDir: string) => number | null;
}

/**
 * All effects {@link execBdWithReconnect} needs. Every field is a seam so the
 * reconnection logic can be exercised without a real dolt server, the real
 * filesystem, or the wall clock.
 */
export interface ReconnectSeams extends EndpointReaders {
  /**
   * Run a single `bd` attempt against the given pinned port (null = let bd use
   * whatever it resolves itself). Returns a {@link BdResult}.
   */
  run: (args: string[], options: BdExecOptions, port: number | null) => Promise<BdResult>;
  /** Delete the stale per-port circuit-breaker file(s) for `port`. */
  clearCircuitFile: (port: number) => Promise<void>;
  /** Async sleep between retry attempts. */
  sleep: (ms: number) => Promise<void>;
  /** Monotonic clock (ms). Injected for deterministic tests. */
  now: () => number;
  /** Total attempt budget (the first try + retries). Defaults to {@link DEFAULT_MAX_ATTEMPTS}. */
  maxAttempts?: number;
  /** First backoff delay (ms). Defaults to {@link DEFAULT_BASE_BACKOFF_MS}. */
  baseBackoffMs?: number;
  /** Backoff ceiling (ms). Defaults to {@link DEFAULT_MAX_BACKOFF_MS}. */
  maxBackoffMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_BACKOFF_MS = 250;
const DEFAULT_MAX_BACKOFF_MS = 4000;

/**
 * In-process connection state. `clearedPorts` tracks the ports whose stale
 * per-port circuit files we already cleared during the CURRENT reconnect episode,
 * so a single episode does not redundantly clear the same file on every attempt.
 * Resetting this state (on a successful reconnect OR an exhausted-budget give-up)
 * is the in-process "breaker reset" that lets a recovered endpoint resume on the
 * next episode without a process restart (adj-182.2.4.1).
 */
interface DoltConnectionState {
  /** Ports whose stale circuit files we already cleared this episode. */
  clearedPorts: Set<number>;
}

let doltConnectionState: DoltConnectionState = {
  clearedPorts: new Set<number>(),
};

/**
 * Reset the in-process Dolt connection state. Called after a successful
 * reconnect AND after an exhausted-budget give-up (so the next episode starts
 * clean and re-clears the circuit file), and by tests for isolation.
 */
export function _resetDoltConnectionState(): void {
  doltConnectionState = { clearedPorts: new Set<number>() };
}

/**
 * Detect whether a `bd` failure is a Dolt CONNECTION failure (server down /
 * circuit open / dial refused) — as opposed to a logic error (bead not found,
 * bad args). Only connection failures are worth reconnecting on; retrying a
 * logic error would just burn the attempt budget on a deterministic failure.
 */
export function isDoltConnectionFailure(stderr: string): boolean {
  if (!stderr) return false;
  const s = stderr.toLowerCase();
  return (
    s.includes("server appears down") ||
    s.includes("circuit breaker is open") ||
    s.includes("connection refused") ||
    s.includes("failed to open database")
  );
}

/**
 * Resolve the currently-pinned Dolt port from the canonical sources, in order:
 *   1. `BEADS_DOLT_SERVER_PORT` env  (authoritative when the supervisor exported it)
 *   2. `<beadsDir>/metadata.json` → `dolt_server_port`  (externally-managed pin)
 *   3. `<beadsDir>/dolt-server.port`  (the server's own self-report)
 * Returns null when no source yields a port.
 */
export function resolvePinnedDoltPort(beadsDir: string, readers: EndpointReaders): number | null {
  const env = readers.readEnvPort();
  if (typeof env === "number") return env;
  const meta = readers.readMetadataPort(beadsDir);
  if (typeof meta === "number") return meta;
  const file = readers.readPortFile(beadsDir);
  if (typeof file === "number") return file;
  return null;
}

/** Clamp a backoff delay to the configured ceiling. */
function backoffDelay(attemptIndex: number, base: number, max: number): number {
  return Math.min(base * 2 ** attemptIndex, max);
}

/**
 * Run a `bd` command with reconnect-on-connection-failure semantics.
 *
 * Flow:
 *   1. Resolve the pinned port and run the command.
 *   2. On SUCCESS: record it as the last-good port, reset the in-process state,
 *      and return.
 *   3. On a NON-connection failure: return immediately (no retry — it would just
 *      repeat a deterministic logic error).
 *   4. On a CONNECTION failure: clear the stale per-port circuit file for the
 *      port we just failed against, sleep with bounded exponential backoff,
 *      re-resolve the pinned endpoint (it may have moved), and retry — up to the
 *      bounded attempt budget. The final connection failure is returned verbatim.
 */
export async function execBdWithReconnect(
  args: string[],
  options: BdExecOptions,
  seams: ReconnectSeams,
): Promise<BdResult> {
  const beadsDir = options.beadsDir ?? resolveBeadsDir(options.cwd ?? process.cwd());
  // Always make at least one attempt — a 0/negative budget would otherwise skip
  // the loop and return a null result.
  const maxAttempts = Math.max(1, seams.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseBackoff = seams.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
  const maxBackoff = seams.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = resolvePinnedDoltPort(beadsDir, seams);
    const result = await seams.run(args, options, port);

    if (result.success) {
      // Reconnect succeeded (or never needed) — reset the in-process breaker so
      // the next call starts clean. THIS is what lets a recovered endpoint resume
      // without a process restart.
      if (attempt > 0) {
        logInfo("bd reconnected to Dolt endpoint", { port, attempts: attempt + 1 });
      }
      _resetDoltConnectionState();
      return result;
    }

    const stderr = result.error?.stderr ?? result.error?.message ?? "";
    const isLastAttempt = attempt === maxAttempts - 1;

    // A deterministic logic error (bead not found, bad args) or the exhausted
    // attempt budget both end the loop — return the result verbatim.
    if (!isDoltConnectionFailure(stderr)) {
      return result;
    }
    if (isLastAttempt) {
      logError("bd Dolt reconnect exhausted attempt budget", { maxAttempts });
      // adj-182.2.4.1: a RECURRING outage burns the budget across multiple episodes.
      // The success path resets the in-process state, but the exhausted-budget path
      // historically did NOT — so the dead port stayed in `clearedPorts` and the NEXT
      // episode against that same still-dead port skipped clearing its stale
      // /tmp/beads-dolt-circuit-<port>.json (the `!clearedPorts.has(port)` guard was
      // false). bd then kept failing fast and recovery-WITHOUT-restart was defeated.
      // Reset here so each fresh episode re-clears the circuit file and re-resolves.
      _resetDoltConnectionState();
      return result;
    }

    // Connection failure with attempts remaining: clear the stale per-port
    // circuit file so bd stops failing fast on this (likely dead) port, then
    // back off before re-resolving the endpoint and retrying.
    if (typeof port === "number" && !doltConnectionState.clearedPorts.has(port)) {
      doltConnectionState.clearedPorts.add(port);
      try {
        await seams.clearCircuitFile(port);
      } catch (err) {
        logWarn("bd reconnect: failed to clear circuit file", { port, error: String(err) });
      }
    }

    const delay = backoffDelay(attempt, baseBackoff, maxBackoff);
    logWarn("bd Dolt connection failure — backing off before reconnect", {
      port,
      attempt: attempt + 1,
      maxAttempts,
      delayMs: delay,
    });
    await seams.sleep(delay);
  }

  // Unreachable: every loop iteration either returns or is followed by another
  // iteration (the last attempt returns above). This satisfies the compiler's
  // definite-return analysis without a non-null assertion.
  throw new Error("execBdWithReconnect: reconnect loop terminated without a result");
}

// ── Production seam implementations ─────────────────────────────────────────

/** Parse a port-like value into a positive integer, or null. */
function parsePort(value: unknown): number | null {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

/** Read `BEADS_DOLT_SERVER_PORT` from the process env. */
function readEnvPortReal(): number | null {
  return parsePort(process.env["BEADS_DOLT_SERVER_PORT"]);
}

/** Read `dolt_server_port` from `<beadsDir>/metadata.json`. */
function readMetadataPortReal(beadsDir: string): number | null {
  const metadataPath = join(beadsDir, "metadata.json");
  if (!existsSync(metadataPath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(metadataPath, "utf-8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsePort((parsed as Record<string, unknown>)["dolt_server_port"]);
    }
  } catch {
    // Malformed metadata — treat as "no port from this source".
  }
  return null;
}

/** Read the port from `<beadsDir>/dolt-server.port`. */
function readPortFileReal(beadsDir: string): number | null {
  const portFile = join(beadsDir, "dolt-server.port");
  if (!existsSync(portFile)) return null;
  try {
    return parsePort(readFileSync(portFile, "utf-8").trim());
  } catch {
    return null;
  }
}

/**
 * Delete the stale per-port circuit-breaker file(s) so `bd` stops failing fast
 * on a dead port. bd 0.60.0 names the file `/tmp/beads-dolt-circuit-<port>.json`;
 * some bd builds use a per-host variant `beads-dolt-circuit-<host>-<port>.json`,
 * so we clear BOTH the exact-port match and any `*-<port>.json` host-scoped file.
 * Best-effort: a missing file is success.
 */
async function clearCircuitFileReal(port: number): Promise<void> {
  const dir = tmpdir();
  const exact = join(dir, `beads-dolt-circuit-${port}.json`);
  if (existsSync(exact)) {
    try {
      unlinkSync(exact);
    } catch {
      // Best-effort.
    }
  }
  // Host-scoped variant: beads-dolt-circuit-<host>-<port>.json
  const suffix = `-${port}.json`;
  try {
    for (const name of readdirSync(dir)) {
      if (name.startsWith("beads-dolt-circuit-") && name.endsWith(suffix)) {
        try {
          unlinkSync(join(dir, name));
        } catch {
          // Best-effort.
        }
      }
    }
  } catch {
    // tmpdir unreadable — nothing to clear.
  }
}

/** Real async sleep used by the production reconnect path. */
function sleepReal(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * The production seam set: spawn `bd` via {@link execBd} (exporting the resolved
 * pinned port into its env so the subprocess targets the live server), read the
 * pinned endpoint from env/metadata/port-file, clear real circuit files, and
 * sleep on the real clock.
 */
export function productionReconnectSeams(): ReconnectSeams {
  return {
    run: (args, options, port) =>
      execBdOnce(args, {
        ...options,
        env: {
          ...options.env,
          // Re-point the bd subprocess at the freshly-resolved pinned port so a
          // moved endpoint is picked up without a process restart.
          ...(typeof port === "number" ? { BEADS_DOLT_SERVER_PORT: String(port) } : {}),
        },
      }),
    readEnvPort: readEnvPortReal,
    readMetadataPort: readMetadataPortReal,
    readPortFile: readPortFileReal,
    clearCircuitFile: clearCircuitFileReal,
    sleep: sleepReal,
    now: () => Date.now(),
  };
}

/**
 * Explicit alias for {@link execBd} (which is itself resilient as of adj-182.2.4).
 * Retained so call sites that want to make the reconnect intent obvious — or that
 * predate the `execBd` merge — keep working without an edit.
 */
export async function execBdResilient<T = unknown>(
  args: string[],
  options: BdExecOptions = {},
): Promise<BdResult<T>> {
  return execBd<T>(args, options);
}
