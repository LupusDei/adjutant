/**
 * Repo guards (adj-mtzot): the two cheap checks that would have caught this bug class in hours.
 *
 * BACKGROUND. The canonical repo's `main` was found carrying 6 commits from ANOTHER project's
 * feature branch, unpushed, while simultaneously sitting one commit BEHIND origin/main — which is
 * how a merged fix ran nowhere for a day. Two guards:
 *
 *   1. scripts/check-main-divergence.sh — alarms when local `main` is AHEAD of origin/main.
 *      Main should only ever fast-forward; anything ahead is unpushed drift.
 *   2. scripts/install-git-hooks.sh — installs a worktree guard into .git/hooks/post-checkout
 *      OUTSIDE the beads-managed markers, because `bd` rewrites everything between its own
 *      BEGIN/END lines and would silently eat a guard placed inside.
 *
 * These shell out against throwaway git repos, so they test the real scripts, not a mock of them.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const DIVERGENCE_SCRIPT = join(REPO_ROOT, "scripts/check-main-divergence.sh");
const INSTALL_HOOKS_SCRIPT = join(REPO_ROOT, "scripts/install-git-hooks.sh");

let workdir: string;

/** Run a script, returning exit code + combined output instead of throwing. */
function run(script: string, args: string[], cwd: string): { code: number; out: string } {
  try {
    const out = execFileSync("bash", [script, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

function git(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** A bare "origin" plus a clone with one commit on main, wired together. */
function makeRepoPair(): { clone: string; origin: string } {
  const origin = join(workdir, "origin.git");
  const clone = join(workdir, "clone");
  execSync(`git init --bare -q --initial-branch=main "${origin}"`);
  execSync(`git init -q --initial-branch=main "${clone}"`);
  git(`config user.email test@example.com`, clone);
  git(`config user.name Test`, clone);
  writeFileSync(join(clone, "a.txt"), "one\n");
  git(`add .`, clone);
  git(`commit -qm "first"`, clone);
  git(`remote add origin "${origin}"`, clone);
  git(`push -q origin main`, clone);
  return { clone, origin };
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "adj-guards-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("check-main-divergence.sh (adj-mtzot step 3)", () => {
  it("should pass when local main matches origin/main", () => {
    const { clone } = makeRepoPair();

    const { code, out } = run(DIVERGENCE_SCRIPT, [], clone);

    expect(code).toBe(0);
    expect(out).toMatch(/ok|in sync|matches/i);
  });

  it("should ALARM (non-zero) when local main is AHEAD of origin/main, naming the commits", () => {
    const { clone } = makeRepoPair();
    writeFileSync(join(clone, "b.txt"), "unpushed\n");
    git(`add .`, clone);
    git(`commit -qm "feat(other-project): work that does not belong on main"`, clone);

    const { code, out } = run(DIVERGENCE_SCRIPT, [], clone);

    expect(code).not.toBe(0);
    // It must say WHAT is adrift, or the alarm is unactionable.
    expect(out).toContain("feat(other-project)");
    expect(out).toMatch(/ahead/i);
  });

  it("should stay silent when main is merely BEHIND (that is normal, not drift)", () => {
    const { clone, origin } = makeRepoPair();
    // Advance origin/main via a second clone, then fetch so the local ref knows it is behind.
    const other = join(workdir, "other");
    execSync(`git clone -q "${origin}" "${other}"`);
    git(`config user.email test@example.com`, other);
    git(`config user.name Test`, other);
    writeFileSync(join(other, "c.txt"), "remote work\n");
    git(`add .`, other);
    git(`commit -qm "second"`, other);
    git(`push -q origin main`, other);
    git(`fetch -q origin`, clone);

    const { code } = run(DIVERGENCE_SCRIPT, [], clone);

    expect(code).toBe(0);
  });

  it("should not block when there is no origin/main to compare against", () => {
    const clone = join(workdir, "solo");
    execSync(`git init -q --initial-branch=main "${clone}"`);
    git(`config user.email test@example.com`, clone);
    git(`config user.name Test`, clone);
    writeFileSync(join(clone, "a.txt"), "one\n");
    git(`add .`, clone);
    git(`commit -qm "first"`, clone);

    const { code } = run(DIVERGENCE_SCRIPT, [], clone);

    // An unusual setup must not fail every push in the repo.
    expect(code).toBe(0);
  });
});

describe("install-git-hooks.sh — worktree guard (adj-mtzot step 2)", () => {
  const BEADS_HOOK = [
    "#!/usr/bin/env sh",
    "# --- BEGIN BEADS INTEGRATION v0.60.0 ---",
    'echo "BEADS_RAN"',
    "# --- END BEADS INTEGRATION v0.60.0 ---",
    "",
  ].join("\n");

  function hookPath(repo: string): string {
    return join(repo, ".git/hooks/post-checkout");
  }

  function writeBeadsHook(repo: string): void {
    mkdirSync(join(repo, ".git/hooks"), { recursive: true });
    writeFileSync(hookPath(repo), BEADS_HOOK);
    chmodSync(hookPath(repo), 0o755);
  }

  it("should place the guard OUTSIDE (above) the beads-managed markers", () => {
    const { clone } = makeRepoPair();
    writeBeadsHook(clone);

    const { code } = run(INSTALL_HOOKS_SCRIPT, [], clone);
    expect(code).toBe(0);

    const hook = readFileSync(hookPath(clone), "utf8");
    const guardAt = hook.indexOf("ADJUTANT WORKTREE GUARD");
    const beadsAt = hook.indexOf("BEGIN BEADS INTEGRATION");
    expect(guardAt).toBeGreaterThan(-1);
    expect(beadsAt).toBeGreaterThan(-1);
    // Outside means BEFORE the beads block — inside it would be regenerated away.
    expect(guardAt).toBeLessThan(beadsAt);
    // The shebang must still be the very first line or the hook will not execute.
    expect(hook.startsWith("#!")).toBe(true);
  });

  it("should be idempotent — running twice leaves exactly one guard", () => {
    const { clone } = makeRepoPair();
    writeBeadsHook(clone);

    run(INSTALL_HOOKS_SCRIPT, [], clone);
    run(INSTALL_HOOKS_SCRIPT, [], clone);

    const hook = readFileSync(hookPath(clone), "utf8");
    const occurrences = hook.split("BEGIN ADJUTANT WORKTREE GUARD").length - 1;
    expect(occurrences).toBe(1);
  });

  it("should SURVIVE a beads regeneration that rewrites the managed block", () => {
    const { clone } = makeRepoPair();
    writeBeadsHook(clone);
    run(INSTALL_HOOKS_SCRIPT, [], clone);

    // Simulate `bd` rewriting only its own block (a new version, different body).
    const hook = readFileSync(hookPath(clone), "utf8");
    const regenerated = hook.replace(
      /# --- BEGIN BEADS INTEGRATION[\s\S]*?# --- END BEADS INTEGRATION[^\n]*\n/,
      ["# --- BEGIN BEADS INTEGRATION v0.99.0 ---", 'echo "BEADS_RAN_V99"', "# --- END BEADS INTEGRATION v0.99.0 ---", ""].join("\n"),
    );
    writeFileSync(hookPath(clone), regenerated);

    expect(readFileSync(hookPath(clone), "utf8")).toContain("ADJUTANT WORKTREE GUARD");
  });

  it("should short-circuit the hook inside a WORKTREE but run it in the canonical repo", () => {
    const { clone } = makeRepoPair();
    writeBeadsHook(clone);
    run(INSTALL_HOOKS_SCRIPT, [], clone);

    // Canonical repo: .git is a DIRECTORY -> the beads block must still run.
    const canonical = execFileSync("sh", [hookPath(clone)], { cwd: clone, encoding: "utf8" });
    expect(canonical).toContain("BEADS_RAN");

    // Linked worktree: .git is a FILE -> the hook must do nothing (dolt panics on
    // concurrent access from parallel worktree checkouts).
    const wt = join(workdir, "wt");
    git(`worktree add -q -b wt-branch "${wt}"`, clone);
    const inWorktree = execFileSync("sh", [hookPath(clone)], { cwd: wt, encoding: "utf8" });
    expect(inWorktree).not.toContain("BEADS_RAN");
  });
});
