import { execFile } from "child_process";
import { logInfo, logWarn } from "../utils/index.js";

function execTmux(args: string[]): Promise<string> {
  const startedAt = Date.now();
  logInfo("tmux exec start", { args });
  return new Promise((resolve, reject) => {
    execFile("tmux", args, { encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) {
        const message = typeof stderr === "string" ? stderr.trim() : "";
        logWarn("tmux exec failed", {
          args,
          durationMs: Date.now() - startedAt,
          message: message || err.message,
        });
        reject(new Error(message || err.message));
        return;
      }
      logInfo("tmux exec success", {
        args,
        durationMs: Date.now() - startedAt,
      });
      resolve(stdout);
    });
  });
}

export async function listTmuxSessions(): Promise<Set<string>> {
  try {
    const output = await execTmux(["list-sessions", "-F", "#{session_name}"]);
    const sessions = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return new Set(sessions);
  } catch {
    return new Set();
  }
}

/**
 * Captures the content of a tmux pane, including ANSI escape codes.
 * @param sessionName - The tmux session name (e.g., "gt-gastown_boy-nux")
 * @returns The raw terminal output with ANSI escape codes preserved
 * @throws Error if the session doesn't exist or capture fails
 */
export async function captureTmuxPane(sessionName: string): Promise<string> {
  // -e preserves ANSI escape sequences for terminal styling
  // -p outputs to stdout instead of a buffer
  const output = await execTmux(["capture-pane", "-t", sessionName, "-e", "-p"]);
  return output;
}
