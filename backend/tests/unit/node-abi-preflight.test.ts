/**
 * adj-juy35: a poisoned native binding must self-heal, not crash-loop.
 *
 * 2026-09-02 outage: better-sqlite3's binding was compiled for Node 22
 * (NODE_MODULE_VERSION 127) while the launchd job runs Node 20.19.6 (115). The
 * backend died with ERR_DLOPEN_FAILED *before* it bound its port, so launchd's
 * KeepAlive restarted it forever — the worst failure mode available, because a
 * crash-loop looks like "the service is starting" rather than "the service is
 * broken", and the only clue was an opaque dlopen error deep in the log.
 *
 * scripts/supervisor/node-abi-preflight.sh runs before the server starts: it
 * LOADS the binding under the running node and, on failure, rebuilds it once
 * and re-checks. These tests drive it with stubbed `node`/`npm` on PATH, so the
 * three outcomes — healthy, healed, unfixable — are all exercised without a
 * real compile.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../scripts/supervisor/node-abi-preflight.sh");

const tempDirs: string[] = [];

afterEach(() => {
  tempDirs.splice(0).forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
});

interface Stubs {
  binDir: string;
  /** Deleted by the stubbed `npm rebuild`, so a stub can "become loadable". */
  brokenFlag: string;
  npmLog: string;
}

/**
 * Stub `node` and `npm`.
 *
 * The stubbed node fails the load check while `brokenFlag` exists; the stubbed
 * npm removes that flag on `rebuild` when `rebuildFixes` is true. That models
 * the real sequence — check, rebuild, re-check — without compiling anything.
 */
function makeStubs(options: { rebuildFixes: boolean; startsBroken: boolean }): Stubs {
  const root = mkdtempSync(join(tmpdir(), "abi-preflight-"));
  tempDirs.push(root);
  const binDir = join(root, "bin");
  mkdirSync(binDir);
  const brokenFlag = join(root, "broken");
  const npmLog = join(root, "npm.log");
  if (options.startsBroken) writeFileSync(brokenFlag, "");

  writeFileSync(
    join(binDir, "node"),
    [
      "#!/bin/sh",
      // `node -p <expr>` -> report a module ABI version, like the real thing.
      'if [ "$1" = "-p" ]; then echo 115; exit 0; fi',
      // `node -e <require>` -> the load check.
      `if [ -f "${brokenFlag}" ]; then`,
      '  echo "Error: The module was compiled against NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 115." >&2',
      "  exit 1",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(join(binDir, "node"), 0o755);

  writeFileSync(
    join(binDir, "npm"),
    [
      "#!/bin/sh",
      `echo "$*" >> "${npmLog}"`,
      ...(options.rebuildFixes ? [`rm -f "${brokenFlag}"`, "exit 0"] : ["exit 1"]),
      "",
    ].join("\n"),
  );
  chmodSync(join(binDir, "npm"), 0o755);

  return { binDir, brokenFlag, npmLog };
}

interface RunResult {
  code: number;
  output: string;
}

async function runPreflight(binDir: string): Promise<RunResult> {
  const env = { ...process.env, PATH: `${binDir}:${process.env["PATH"] ?? ""}` };
  try {
    const { stdout, stderr } = await execFileAsync("bash", [SCRIPT], { env });
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, output: (failure.stdout ?? "") + (failure.stderr ?? "") };
  }
}

function npmCalls(logPath: string): string {
  return existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
}

describe("node-abi-preflight.sh", () => {
  it("should exit 0 and rebuild nothing when the binding already loads", async () => {
    const { binDir, npmLog } = makeStubs({ rebuildFixes: true, startsBroken: false });

    const result = await runPreflight(binDir);

    expect(result.code).toBe(0);
    // A rebuild on every boot would add ~30s to each launchd restart for nothing.
    expect(npmCalls(npmLog)).toBe("");
  });

  it("should rebuild the module and exit 0 when the binding is ABI-poisoned", async () => {
    const { binDir, npmLog } = makeStubs({ rebuildFixes: true, startsBroken: true });

    const result = await runPreflight(binDir);

    expect(result.code).toBe(0);
    expect(npmCalls(npmLog)).toContain("rebuild");
    expect(npmCalls(npmLog)).toContain("better-sqlite3");
  });

  it("should fail loudly with an actionable message when the rebuild does not fix it", async () => {
    const { binDir } = makeStubs({ rebuildFixes: false, startsBroken: true });

    const result = await runPreflight(binDir);

    expect(result.code).not.toBe(0);
    // The 2026-09-02 log gave only ERR_DLOPEN_FAILED. The operator needs the
    // module, the running node's ABI, and the command that fixes it.
    expect(result.output).toContain("better-sqlite3");
    expect(result.output).toContain("115");
    expect(result.output).toMatch(/npm rebuild/);
  });

  it("should be wired into the launchd wrapper BEFORE the server is exec'd", async () => {
    // A preflight nobody calls is decoration. It must also gate the exec: if the
    // binding cannot be made to load, not starting beats an invisible KeepAlive
    // restart loop.
    const wrapper = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../scripts/supervisor/adjutant-backend.sh"),
      "utf8",
    );
    const preflightAt = wrapper.indexOf("node-abi-preflight.sh");
    // Match the first `exec` line, whatever it launches — the wrapper has used
    // both `npx tsx` and `./node_modules/.bin/tsx`, and the ordering guarantee
    // is what matters, not which runner is in fashion.
    const execAt = wrapper.search(/^\s*exec /m);

    expect(preflightAt).toBeGreaterThan(-1);
    expect(execAt).toBeGreaterThan(preflightAt);
    expect(wrapper).toContain("not starting");
  });

  it("should say what it is doing before a rebuild, so a slow boot is explicable", async () => {
    const { binDir } = makeStubs({ rebuildFixes: true, startsBroken: true });

    const result = await runPreflight(binDir);

    expect(result.output).toMatch(/ABI mismatch|rebuild/i);
  });
});
