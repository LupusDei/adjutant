import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { logError, logInfo, logWarn } from "../utils/index.js";

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

export async function execBd<T = unknown>(
  args: string[],
  options: BdExecOptions = {}
): Promise<BdResult<T>> {
  const { cwd = process.cwd(), timeout = DEFAULT_TIMEOUT, parseJson = true, env } = options;
  const beadsDir = options.beadsDir ?? resolveBeadsDir(cwd);
  const fullArgs = ["--no-daemon", "--allow-stale", "--lock-timeout", "2s", ...args];
  const startedAt = Date.now();
  logInfo("bd exec start", { args: fullArgs });

  return new Promise((resolveResult) => {
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
        logError("bd exec failed", {
          args: fullArgs,
          exitCode,
          durationMs: Date.now() - startedAt,
          message: stderrTrimmed || `Command exited with code ${exitCode}`,
        });
        finish({
          success: false,
          error: {
            code: "COMMAND_FAILED",
            message: stderrTrimmed || `Command exited with code ${exitCode}`,
            ...(stderrTrimmed ? { stderr: stderrTrimmed } : {}),
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
}
