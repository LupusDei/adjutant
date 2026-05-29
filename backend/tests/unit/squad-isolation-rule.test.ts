import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * adj-c2bbv: the worktree-RESUME cwd-reset hazard must be baked into the squad
 * spawn tooling so it's enforced by the templates, not left to memory. A
 * resumed background worktree agent runs in the MAIN REPO cwd, so its Bash file
 * ops silently leak into the shared tree (the adj-iqyqw data-loss incidents).
 *
 * These tests assert the mitigation text is present in:
 *  - skills/squad-execute/SKILL.md          (leader: prefer fresh spawns)
 *  - skills/squad-execute/squad-member-context.md (agent: self-protect on resume)
 * so the rule can't be silently dropped.
 */
const ROOT = join(__dirname, "..", "..", "..");
const SKILL = readFileSync(join(ROOT, "skills/squad-execute/SKILL.md"), "utf-8");
const MEMBER = readFileSync(join(ROOT, "skills/squad-execute/squad-member-context.md"), "utf-8");

describe("squad-execute worktree resume-hazard rule (adj-c2bbv)", () => {
  describe("SKILL.md (squad leader guidance)", () => {
    it("references the adj-c2bbv hazard so the rationale is traceable", () => {
      expect(SKILL).toContain("adj-c2bbv");
    });

    it("warns NOT to SendMessage-resume a completed worktree agent for file work", () => {
      expect(SKILL).toMatch(/resume/i);
      expect(SKILL).toMatch(/main repo/i);
      // Must steer toward spawning a fresh agent instead.
      expect(SKILL).toMatch(/fresh .*(agent|worktree)/i);
    });

    it("documents the must-cd fallback when a resume is unavoidable", () => {
      expect(SKILL).toMatch(/cd .*worktree/i);
      expect(SKILL).toMatch(/git status/i);
    });
  });

  describe("squad-member-context.md (per-agent self-protection)", () => {
    it("references the adj-c2bbv hazard", () => {
      expect(MEMBER).toContain("adj-c2bbv");
    });

    it("tells a resumed agent it may be in the main repo and to cd into its worktree", () => {
      expect(MEMBER).toMatch(/resumed/i);
      expect(MEMBER).toMatch(/main repo/i);
      expect(MEMBER).toMatch(/cd .*worktree/i);
    });

    it("tells the agent to verify the main repo working tree stays clean", () => {
      expect(MEMBER).toMatch(/git status/i);
    });
  });

  // adj-laz97: a worktree agent that runs `git checkout -b` while its cwd has
  // leaked to the main repo moves MAIN's HEAD onto a stray branch (corrupting
  // the squad's merge target). A worktree agent is ALREADY on its branch and
  // never needs to create/switch one — forbid it, and assert worktree residence
  // before any git write.
  describe("git branch-op guard (adj-laz97)", () => {
    it("squad-member-context references the adj-laz97 hazard", () => {
      expect(MEMBER).toContain("adj-laz97");
    });

    it("squad-member-context forbids creating/switching branches in a worktree agent", () => {
      expect(MEMBER).toMatch(/never .*(checkout -b|create .*branch|switch .*branch)/i);
      expect(MEMBER).toMatch(/git checkout -b/i);
      // Already on its own branch — should push the current branch / HEAD.
      expect(MEMBER).toMatch(/already on .*branch/i);
    });

    it("squad-member-context requires a worktree-residence assertion before git writes", () => {
      expect(MEMBER).toMatch(/\.claude\/worktrees/i);
      expect(MEMBER).toMatch(/show-toplevel|--git-dir|git-common-dir/i);
    });

    it("SKILL.md references adj-laz97 and forbids worktree agents from checkout -b", () => {
      expect(SKILL).toContain("adj-laz97");
      expect(SKILL).toMatch(/git checkout -b/i);
    });

    it("SKILL.md requires the coordinator to verify it is on main before merge/push", () => {
      expect(SKILL).toMatch(/branch --show-current/i);
      expect(SKILL).toMatch(/before .*(merge|push)/i);
    });
  });
});
