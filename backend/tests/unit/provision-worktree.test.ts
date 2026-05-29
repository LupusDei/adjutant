import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  existsSync,
  accessSync,
  constants,
} from "fs";
import { tmpdir } from "os";
import { resolve, join } from "path";

const SCRIPT = resolve(__dirname, "../../../scripts/provision-worktree.sh");

/**
 * adj-pd49t: a fresh git worktree has no node_modules (they're gitignored, so
 * `git worktree add` omits them), forcing a slow `npm install` that trips the
 * 600s spawn watchdog. provision-worktree.sh symlinks node_modules from the main
 * repo into the worktree instantly. These tests run the real script against a
 * temp "repo + worktree" layout.
 */
describe("provision-worktree.sh", () => {
  let tmp: string;
  let mainRepo: string;
  let worktree: string;

  const run = (args: string[]) =>
    spawnSync("bash", [SCRIPT, ...args], { encoding: "utf-8" });

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "provision-wt-"));
    // Fake main repo with node_modules at root + backend + frontend.
    mainRepo = join(tmp, "main");
    for (const rel of ["node_modules", "backend/node_modules", "frontend/node_modules"]) {
      mkdirSync(join(mainRepo, rel), { recursive: true });
      writeFileSync(join(mainRepo, rel, ".marker"), rel);
    }
    // Fresh worktree with the backend/frontend dirs but NO node_modules.
    worktree = join(tmp, "wt");
    mkdirSync(join(worktree, "backend"), { recursive: true });
    mkdirSync(join(worktree, "frontend"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  const isSymlinkTo = (linkPath: string, target: string) => {
    const st = lstatSync(linkPath);
    expect(st.isSymbolicLink(), `${linkPath} should be a symlink`).toBe(true);
    // Resolve to the same real path as the intended target.
    expect(realpathSync(linkPath)).toBe(realpathSync(target));
  };

  it("should exist and be executable", () => {
    accessSync(SCRIPT, constants.F_OK);
    accessSync(SCRIPT, constants.X_OK);
  });

  it("should symlink root, backend, and frontend node_modules from the main repo", () => {
    const r = run([worktree, mainRepo]);
    expect(r.status).toBe(0);
    isSymlinkTo(join(worktree, "node_modules"), join(mainRepo, "node_modules"));
    isSymlinkTo(join(worktree, "backend/node_modules"), join(mainRepo, "backend/node_modules"));
    isSymlinkTo(join(worktree, "frontend/node_modules"), join(mainRepo, "frontend/node_modules"));
  });

  it("should make a symlinked dependency resolvable inside the worktree", () => {
    run([worktree, mainRepo]);
    // The marker file written in the main repo is visible through the symlink.
    expect(existsSync(join(worktree, "backend/node_modules/.marker"))).toBe(true);
  });

  it("should be idempotent — a second run does not error or clobber", () => {
    const first = run([worktree, mainRepo]);
    expect(first.status).toBe(0);
    const link = join(worktree, "node_modules");
    const before = readlinkSync(link);
    const second = run([worktree, mainRepo]);
    expect(second.status).toBe(0);
    expect(readlinkSync(link)).toBe(before);
  });

  it("should NOT clobber a real (non-symlink) node_modules already present in the worktree", () => {
    // Worktree already has a real backend/node_modules (e.g. agent ran install).
    mkdirSync(join(worktree, "backend/node_modules"), { recursive: true });
    writeFileSync(join(worktree, "backend/node_modules", ".own"), "local");
    const r = run([worktree, mainRepo]);
    expect(r.status).toBe(0);
    // It must remain a real directory, not be replaced by a symlink.
    expect(lstatSync(join(worktree, "backend/node_modules")).isSymbolicLink()).toBe(false);
    expect(existsSync(join(worktree, "backend/node_modules/.own"))).toBe(true);
  });

  it("should skip a source that does not exist in the main repo (no error)", () => {
    rmSync(join(mainRepo, "frontend/node_modules"), { recursive: true, force: true });
    const r = run([worktree, mainRepo]);
    expect(r.status).toBe(0);
    // frontend link not created (source missing), but root + backend still linked.
    expect(existsSync(join(worktree, "frontend/node_modules"))).toBe(false);
    isSymlinkTo(join(worktree, "node_modules"), join(mainRepo, "node_modules"));
  });

  it("should fail with a clear error when the worktree path does not exist", () => {
    const r = run([join(tmp, "nonexistent"), mainRepo]);
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/worktree/i);
  });

  it("should be referenced as a setup step in the squad-member context (adj-pd49t)", () => {
    const member = readFileSync(
      resolve(__dirname, "../../../skills/squad-execute/squad-member-context.md"),
      "utf-8",
    );
    expect(member).toMatch(/provision-worktree\.sh/);
    // Must steer agents away from the slow npm install that trips the watchdog.
    expect(member).toMatch(/npm install/i);
  });

  it("should auto-detect the main repo from a real linked worktree (no main arg)", () => {
    // Build a real git repo with node_modules, add a linked worktree, then run
    // the script with NO main-repo arg — it must find the main repo via git.
    const gitRepo = join(tmp, "gitmain");
    const git = (args: string[], cwd: string) =>
      spawnSync("git", ["-c", "user.email=t@t.io", "-c", "user.name=T", ...args], {
        cwd,
        encoding: "utf-8",
      });
    mkdirSync(gitRepo, { recursive: true });
    git(["init", "-q"], gitRepo);
    // Mirror the real repo: node_modules is gitignored, so it is NOT checked out
    // into a fresh worktree (which is exactly why provisioning is needed).
    writeFileSync(join(gitRepo, ".gitignore"), "node_modules/\n");
    mkdirSync(join(gitRepo, "backend"), { recursive: true });
    writeFileSync(join(gitRepo, "backend/.keep"), "");
    writeFileSync(join(gitRepo, "README.md"), "hi");
    git(["add", "-A"], gitRepo);
    git(["commit", "-qm", "init"], gitRepo);
    // Now create the (ignored) node_modules in the main repo, post-commit.
    mkdirSync(join(gitRepo, "node_modules"), { recursive: true });
    writeFileSync(join(gitRepo, "node_modules", ".marker"), "root");
    mkdirSync(join(gitRepo, "backend/node_modules"), { recursive: true });
    writeFileSync(join(gitRepo, "backend/node_modules", ".marker"), "backend");

    const linkedWt = join(gitRepo, "wt-linked");
    const add = git(["worktree", "add", "-q", linkedWt, "-b", "wtbranch"], gitRepo);
    expect(add.status, add.stderr).toBe(0);

    // No 2nd arg — script must auto-detect main repo via git-common-dir.
    const r = run([linkedWt]);
    expect(r.status, r.stderr).toBe(0);
    expect(lstatSync(join(linkedWt, "node_modules")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(linkedWt, "node_modules/.marker"))).toBe(true);
    expect(existsSync(join(linkedWt, "backend/node_modules/.marker"))).toBe(true);
  });
});
