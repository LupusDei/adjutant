/**
 * adj-juy35: refuse an install that would recompile this tree for a DIFFERENT
 * node ABI than the one that built it.
 *
 * The 2026-09-02 outage came from an npm install run in a Node 22 shell against
 * a tree the Node 20 launchd job runs: better-sqlite3 was recompiled for
 * NODE_MODULE_VERSION 127, and the backend then died with ERR_DLOPEN_FAILED
 * before binding — crash-looping invisibly behind launchd KeepAlive.
 *
 * The guard is NOT "node must be 20". This package is published, and the root
 * package installs backend/ on end-user machines where Node 22 is perfectly
 * valid — an absolute pin would break them. The invariant that actually matters
 * is a MISMATCH one: node_modules must be built by the same node that runs the
 * service. So a fresh tree installs under anything, and only a *change* of ABI
 * against an already-built tree is refused.
 *
 * scripts/node-abi-stamp.mjs is both halves: `--stamp` (postinstall) records the
 * ABI, the bare form (preinstall) enforces it.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts/node-abi-stamp.mjs");
const CURRENT_ABI = process.versions.modules;

const tempDirs: string[] = [];

afterEach(() => {
  tempDirs.splice(0).forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
});

/** A package dir with a node_modules, optionally carrying an existing stamp. */
function makeTree(stampAbi?: string): { dir: string; stampPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "abi-stamp-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "node_modules"));
  const stampPath = join(dir, "node_modules", ".adjutant-node-abi");
  if (stampAbi !== undefined) {
    writeFileSync(stampPath, JSON.stringify({ modules: stampAbi, node: "v22.23.1" }));
  }
  return { dir, stampPath };
}

async function run(dir: string, args: string[] = [], env: Record<string, string> = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [SCRIPT, ...args], {
      cwd: dir,
      env: { ...process.env, ...env },
    });
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, output: (failure.stdout ?? "") + (failure.stderr ?? "") };
  }
}

describe("node-abi-stamp.mjs", () => {
  it("should allow an install on a fresh tree that has no stamp", async () => {
    const { dir } = makeTree();

    const result = await run(dir);

    // End users installing the published package land here under any supported
    // node — the guard must never make a first install fail.
    expect(result.code).toBe(0);
  });

  it("should record the running node's ABI when stamping", async () => {
    const { dir, stampPath } = makeTree();

    const result = await run(dir, ["--stamp"]);

    expect(result.code).toBe(0);
    expect(existsSync(stampPath)).toBe(true);
    expect(JSON.parse(readFileSync(stampPath, "utf8"))).toMatchObject({ modules: CURRENT_ABI });
  });

  it("should allow an install when the stamp matches the running node", async () => {
    const { dir } = makeTree(CURRENT_ABI);

    const result = await run(dir);

    expect(result.code).toBe(0);
  });

  it("should REFUSE an install that would rebuild the tree for a different ABI", async () => {
    // The incident, exactly: a tree built for this node, an install attempted
    // from a shell whose node has a different NODE_MODULE_VERSION.
    const otherAbi = CURRENT_ABI === "127" ? "115" : "127";
    const { dir } = makeTree(otherAbi);

    const result = await run(dir);

    expect(result.code).not.toBe(0);
    expect(result.output).toContain(otherAbi);
    expect(result.output).toContain(CURRENT_ABI);
    // Must be actionable: the operator needs the way out, not just a refusal.
    expect(result.output).toMatch(/ADJUTANT_ALLOW_NODE_ABI_SWITCH/);
  });

  it("should allow a deliberate ABI switch when the override is set", async () => {
    const otherAbi = CURRENT_ABI === "127" ? "115" : "127";
    const { dir } = makeTree(otherAbi);

    const result = await run(dir, [], { ADJUTANT_ALLOW_NODE_ABI_SWITCH: "1" });

    expect(result.code).toBe(0);
  });

  it("should not fail an install merely because the stamp is unreadable", async () => {
    const { dir, stampPath } = makeTree();
    writeFileSync(stampPath, "{ not json");

    const result = await run(dir);

    // A corrupt stamp is not evidence of a mismatch. Blocking every install on
    // a garbled file would be a self-inflicted outage of its own.
    expect(result.code).toBe(0);
  });
});
