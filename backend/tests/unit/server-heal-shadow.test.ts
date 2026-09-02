/**
 * adj-z9dqs: the watchdog must detect a SHADOWED backend, not just a dead one.
 *
 * On 2026-09-02 a duplicate Vite bound :4201 on IPv6 and answered every request
 * that resolved `localhost` to ::1 with index.html. The fleet was unusable, yet
 * scripts/supervisor/adjutant-server-heal.sh reported everything healthy for two
 * reasons, both of which these tests pin shut:
 *
 *   1. it probed 127.0.0.1, the ONE address the squatter did not hold; and
 *   2. it only checked that the request succeeded — and a Vite dev server
 *      happily returns 200 + index.html for /health.
 *
 * So the probe must go through `localhost` (the name every client actually
 * resolves) AND assert the body is the backend's own payload.
 *
 * curl and launchctl are stubbed by prepending a temp dir to PATH, so the test
 * touches neither the network nor the real launchd jobs.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/supervisor/adjutant-server-heal.sh",
);

const tempDirs: string[] = [];

afterEach(() => {
  tempDirs.splice(0).forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
});

/** URL -> canned response body. A URL with no entry makes the stubbed curl fail. */
function makeStubs(responses: Record<string, string>): { binDir: string; kickstartLog: string } {
  const root = mkdtempSync(join(tmpdir(), "server-heal-"));
  tempDirs.push(root);
  const binDir = join(root, "bin");
  const bodyDir = join(root, "bodies");
  mkdirSync(binDir);
  mkdirSync(bodyDir);

  for (const [url, body] of Object.entries(responses)) {
    writeFileSync(join(bodyDir, slug(url)), body);
  }

  const kickstartLog = join(root, "kickstart.log");

  // Stubbed curl: last argument is the URL. Emit the canned body, or exit 22
  // (curl's HTTP-error code) when there is no entry for that URL.
  writeFileSync(
    join(binDir, "curl"),
    [
      "#!/bin/sh",
      'for arg in "$@"; do url="$arg"; done',
      `slug=$(printf '%s' "$url" | tr -c 'a-zA-Z0-9' '_')`,
      `body="${bodyDir}/$slug"`,
      '[ -f "$body" ] || exit 22',
      'cat "$body"',
      "",
    ].join("\n"),
  );
  chmodSync(join(binDir, "curl"), 0o755);

  writeFileSync(
    join(binDir, "launchctl"),
    ["#!/bin/sh", `echo "$*" >> "${kickstartLog}"`, "exit 0", ""].join("\n"),
  );
  chmodSync(join(binDir, "launchctl"), 0o755);

  return { binDir, kickstartLog };
}

function slug(url: string): string {
  return url.replace(/[^a-zA-Z0-9]/g, "_");
}

const BACKEND_URL = "http://localhost:4201/health";
const FRONTEND_URL = "http://localhost:4200/";
const NGROK_URL = "https://ngrok.test";

const HEALTHY_BACKEND = '{"status":"ok"}';
const VITE_INDEX_HTML = '<!doctype html><html><body><div id="root"></div></body></html>';

async function runHeal(binDir: string): Promise<string> {
  const { stdout } = await execFileAsync("bash", [SCRIPT], {
    env: { ...process.env, PATH: `${binDir}:${process.env["PATH"] ?? ""}`, ADJUTANT_NGROK_URL: NGROK_URL },
  });
  return stdout;
}

function kickstarted(logPath: string): string {
  return existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
}

describe("adjutant-server-heal.sh", () => {
  it("should probe the backend through localhost, not 127.0.0.1", () => {
    const source = readFileSync(SCRIPT, "utf8");
    // 127.0.0.1 was the blind spot: it is the one address an IPv6 squatter
    // cannot take, so the probe passed while every real client failed.
    expect(source).toContain("http://localhost:4201/health");
    expect(source).not.toContain("http://127.0.0.1:4201/health");
  });

  it("should kickstart nothing when every service answers with its own payload", async () => {
    const { binDir, kickstartLog } = makeStubs({
      [BACKEND_URL]: HEALTHY_BACKEND,
      [FRONTEND_URL]: VITE_INDEX_HTML,
      [NGROK_URL]: VITE_INDEX_HTML,
    });

    await runHeal(binDir);

    expect(kickstarted(kickstartLog)).toBe("");
  });

  it("should flag the backend as unhealthy when Vite shadows the port and returns index.html", async () => {
    const { binDir, kickstartLog } = makeStubs({
      [BACKEND_URL]: VITE_INDEX_HTML, // 200 OK — but not the backend
      [FRONTEND_URL]: VITE_INDEX_HTML,
      [NGROK_URL]: VITE_INDEX_HTML,
    });

    const stdout = await runHeal(binDir);

    expect(kickstarted(kickstartLog)).toContain("com.adjutant.backend");
    expect(stdout).toMatch(/shadow/i);
  });

  it("should kickstart a service whose probe fails outright", async () => {
    const { binDir, kickstartLog } = makeStubs({
      [FRONTEND_URL]: VITE_INDEX_HTML,
      [NGROK_URL]: VITE_INDEX_HTML,
      // backend entry omitted -> stubbed curl exits non-zero
    });

    await runHeal(binDir);

    expect(kickstarted(kickstartLog)).toContain("com.adjutant.backend");
  });
});
