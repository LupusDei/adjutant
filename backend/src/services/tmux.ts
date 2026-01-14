import { execFile } from "child_process";

function execTmux(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("tmux", args, { encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) {
        const message = typeof stderr === "string" ? stderr.trim() : "";
        reject(new Error(message || err.message));
        return;
      }
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
