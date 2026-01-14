import { spawn } from "child_process";
import { logError, logInfo, logWarn } from "../utils/index.js";

export interface GtControlResult {
  success: boolean;
  data?: string;
  error?: {
    code: string;
    message: string;
  };
  exitCode: number;
}

export interface GtControlOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string | undefined>;
}

const DEFAULT_TIMEOUT = 30000;

function resolveGtBinary(): string {
  return process.env["GT_BIN"] ?? process.env["GT_PATH"] ?? "gt";
}

export async function execGtControl(
  args: string[],
  options: GtControlOptions = {}
): Promise<GtControlResult> {
  const { cwd = process.cwd(), timeout = DEFAULT_TIMEOUT, env } = options;
  const gtBinary = resolveGtBinary();
  const startedAt = Date.now();
  logInfo("gt exec start", { args, binary: gtBinary });

  return new Promise((resolveResult) => {
    const child = spawn(gtBinary, args, {
      cwd,
      env: { ...process.env, ...env },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeoutMs = Math.max(0, timeout);
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: GtControlResult) => {
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
        logWarn("gt exec timed out", {
          args,
          binary: gtBinary,
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
      logError("gt exec spawn error", {
        args,
        binary: gtBinary,
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
      if (exitCode !== 0) {
        logError("gt exec failed", {
          args,
          binary: gtBinary,
          exitCode,
          durationMs: Date.now() - startedAt,
          message: stderr.trim() || `Command exited with code ${exitCode}`,
        });
        finish({
          success: false,
          error: {
            code: "COMMAND_FAILED",
            message: stderr.trim() || `Command exited with code ${exitCode}`,
          },
          exitCode,
        });
        return;
      }

      logInfo("gt exec success", {
        args,
        binary: gtBinary,
        exitCode,
        durationMs: Date.now() - startedAt,
      });
      finish({
        success: true,
        data: stdout.trim(),
        exitCode,
      });
    });
  });
}
