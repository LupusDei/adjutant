/**
 * Repo hygiene: node_modules must NEVER be tracked — not as a directory, and
 * not as the SYMLINK that every worktree has.
 *
 * WHAT HAPPENED (2026-09-02). `.gitignore` said `node_modules/`. That trailing
 * slash matches directories only, and `scripts/provision-worktree.sh` gives each
 * worktree a node_modules SYMLINK — a file, not a directory. So it was never
 * ignored, and a routine `git add -A frontend` committed
 * `frontend/node_modules -> /Users/.../adjutant/frontend/node_modules`.
 *
 * In a worktree that link is correct. In the CANONICAL repo it points at itself,
 * and checking it out replaced the real node_modules with the loop (git
 * overwrites ignored paths without complaint). The frontend then died on
 * "Too many levels of symbolic links" and crash-looped behind launchd until the
 * tree was reinstalled by hand — a dependency outage caused by a commit that
 * touched no dependency.
 *
 * The ignore rule is fixed. This test is the tripwire, because the failure is
 * silent at commit time and only detonates on someone else's checkout.
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("repo hygiene: node_modules is never tracked", () => {
  it("should have no tracked path named node_modules, in any form", () => {
    const tracked = execFileSync("git", ["ls-files", "-s"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });

    const offenders = tracked
      .split("\n")
      .filter((line) => /(^|\/)node_modules(\/|$)/.test(line.split("\t")[1] ?? ""))
      .map((line) => line.split("\t")[1]);

    expect(offenders).toEqual([]);
  });

  it("should ignore a node_modules SYMLINK, not just a directory", () => {
    // The precise hole that caused the outage: `git check-ignore` is the same
    // decision `git add` makes, so this asserts the rule as git reads it.
    const ignored = (path: string): boolean => {
      try {
        execFileSync("git", ["check-ignore", "-q", path], { cwd: REPO_ROOT });
        return true;
      } catch {
        return false;
      }
    };

    expect(ignored("frontend/node_modules")).toBe(true);
    expect(ignored("backend/node_modules")).toBe(true);
    expect(ignored("node_modules")).toBe(true);
  });
});
