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
 * The command currently running in a tmux pane (adj-c55l3).
 *
 * Used to tell a live Claude Code TUI from a bare shell before typing into a pane:
 * `send-keys` into a running Claude submits the text as a user prompt, so anything
 * shell-shaped ("export FOO=bar") lands in the conversation instead of the shell.
 *
 * Returns the command name, e.g. "claude", "node", "zsh", "bash". Throws if the
 * pane cannot be read — callers should treat that as "do not type here".
 */
export async function getPaneCurrentCommand(target: string): Promise<string> {
  const output = await execTmux(["display-message", "-p", "-t", target, "#{pane_current_command}"]);
  return output.trim();
}

/**
 * Shell command names that mean "this pane is at a prompt, typing is safe".
 * Anything else — claude, node, vim, a build — is a running program.
 */
const SHELL_COMMANDS = new Set(["bash", "zsh", "sh", "fish", "ksh", "dash", "tcsh", "csh"]);

export function isShellPaneCommand(command: string): boolean {
  return SHELL_COMMANDS.has(command.trim().toLowerCase());
}

/**
 * Captures the content of a tmux pane, including ANSI escape codes.
 * @param sessionName - The tmux session name
 * @returns The raw terminal output with ANSI escape codes preserved
 * @throws Error if the session doesn't exist or capture fails
 */
export async function captureTmuxPane(sessionName: string): Promise<string> {
  // -e preserves ANSI escape sequences for terminal styling
  // -p outputs to stdout instead of a buffer
  const output = await execTmux(["capture-pane", "-t", sessionName, "-e", "-p"]);
  return output;
}
