/**
 * Tests for checkBdSchema() + fixBdSchema() — the bd/dolt schema-currency group in
 * `adjutant doctor` (adj-7h8ve, epic adj-182).
 *
 * BACKGROUND. The fleet runs a supervised, pinned-port Dolt server per project; bd
 * connects in server mode. bd 1.0.4 had a server-mode write-hang (it auto-imports
 * issues.jsonl on every write). The fix is upstream #4170 ("auto-import: gate server
 * mode at call site"), which only exists in builds AFTER the `0043` schema migration
 * (`0043_drop_dependencies_generated_column` — restructures the `dependencies` table
 * to a surrogate `id CHAR(36)` PK). A migrated DB therefore has a `dependencies.id`
 * column; a pre-0043 DB does not.
 *
 * checkBdSchema() (PURE) verifies, each as a CheckResult, from injected seam RESULTS
 * (not live calls):
 *   - the installed bd carries the #4170 fix (version is a HEAD- build OR >= 1.0.5);
 *   - the Dolt working set is NOT dirty (a half-applied 0043 migration — a READ starts
 *     the 0043 chain but never commits, leaving schema_migrations + tables modified);
 *   - the `dependencies` table has the `id` column (0043 applied).
 *
 * fixBdSchema() (SEAM-INJECTED) orchestrates the 5-step VALIDATED repair:
 *   1. backup the .beads/dolt dir + issues.jsonl (forward-only; backup IS the rollback);
 *   2. detect dirty working set (`dolt status`);
 *   3. if dirty: `dolt reset --hard` (discards the half-applied migration; the live
 *      supervised server stays up — the dolt CLI routes to the running server);
 *   4. migrate-via-write: `bd create` + `bd close` — a WRITE applies AND commits 0043
 *      in one op (a READ leaves it dirty, a WRITE commits it);
 *   5. verify: a second `bd create` + `bd close` completes cleanly.
 *
 * SAFETY: every external effect (exec of dolt/bd, the backup copy) is an INJECTED seam.
 * This test runs NO real dolt/bd, never touches a live server, never copies real files.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  checkBdSchema,
  fixBdSchema,
  type CheckBdSchemaOptions,
  type FixBdSchemaOptions,
} from "../../../cli/commands/doctor.js";
import type { ExecResult } from "../../../cli/lib/dolt-supervisor.js";
import type { CheckResult } from "../../../cli/lib/output.js";

const FIXED_VERSION = "HEAD-1825cf3 (Homebrew: HEAD@1825cf3572ce)";
const REPO_DIR = "/Users/me/proj";
const DB_NAME = "beads_adj";

/** Look up a single CheckResult by a substring of its name. */
function find(results: CheckResult[], nameContains: string): CheckResult | undefined {
  return results.find((r) => r.name.toLowerCase().includes(nameContains.toLowerCase()));
}

// ── checkBdSchema (pure) ───────────────────────────────────────────────────────

describe("checkBdSchema", () => {
  /** A fully-healthy, migrated, fix-present system. */
  function healthy(overrides: Partial<CheckBdSchemaOptions> = {}): CheckBdSchemaOptions {
    return {
      bdVersion: FIXED_VERSION,
      dependenciesHasIdColumn: true,
      workingSetDirty: false,
      isBeadsProject: true,
      ...overrides,
    };
  }

  it("should return [] when it is not a beads project", () => {
    const results = checkBdSchema(healthy({ isBeadsProject: false }));
    expect(results).toEqual([]);
  });

  it("should PASS when the fix is present, 0043 applied, and the working set is clean", () => {
    const results = checkBdSchema(healthy());
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("pass");
    expect(results[0].message).toMatch(/0043/);
    expect(results[0].message).toMatch(/4170/);
  });

  it("should FAIL when bd lacks the #4170 fix (plain 1.0.4)", () => {
    const results = checkBdSchema(healthy({ bdVersion: "1.0.4" }));
    const r = find(results, "bd");
    expect(r?.status).toBe("fail");
    expect(r?.message).toMatch(/4170/);
    expect(r?.message).toMatch(/--fix/);
  });

  it("should FAIL for any pre-1.0.5 release (1.0.0)", () => {
    const results = checkBdSchema(healthy({ bdVersion: "1.0.0" }));
    expect(find(results, "bd")?.status).toBe("fail");
  });

  it("should PASS the version gate for a HEAD- build", () => {
    // A HEAD- build always carries the fix regardless of the leading numbers.
    const results = checkBdSchema(healthy({ bdVersion: "HEAD-deadbeef" }));
    expect(results[0].status).toBe("pass");
  });

  it("should PASS the version gate for a tagged release >= 1.0.5", () => {
    const results = checkBdSchema(healthy({ bdVersion: "1.0.5" }));
    expect(results[0].status).toBe("pass");
  });

  it("should PASS the version gate for a tagged release > 1.0.5 (1.2.0)", () => {
    const results = checkBdSchema(healthy({ bdVersion: "1.2.0" }));
    expect(results[0].status).toBe("pass");
  });

  it("should FAIL when the Dolt working set is dirty (half-applied 0043 migration)", () => {
    const results = checkBdSchema(healthy({ workingSetDirty: true }));
    const r = find(results, "working set");
    expect(r?.status).toBe("fail");
    expect(r?.message).toMatch(/0043/);
    expect(r?.message).toMatch(/--fix/);
  });

  it("should FAIL when the dependencies table is pre-0043 (no id column)", () => {
    const results = checkBdSchema(healthy({ dependenciesHasIdColumn: false }));
    const r = find(results, "schema");
    expect(r?.status).toBe("fail");
    expect(r?.message).toMatch(/0043/);
    expect(r?.message).toMatch(/--fix/);
  });

  it("should prioritize the bd-version FAIL over schema/dirty FAILs", () => {
    // Without the fixed bd, migrating is pointless — the version gate fails first.
    const results = checkBdSchema(
      healthy({ bdVersion: "1.0.4", dependenciesHasIdColumn: false, workingSetDirty: true }),
    );
    expect(results).toHaveLength(1);
    expect(find(results, "bd")?.status).toBe("fail");
  });
});

// ── fixBdSchema (seam-injected) ────────────────────────────────────────────────

/** A `dolt status` output indicating a DIRTY working set (half-applied 0043). */
const DIRTY_STATUS = `On branch main
Changes not staged for commit:
  (use ("dolt add <table>") to update what will be committed)
  (use ("dolt checkout <table>") to discard changes in working directory)
	modified:         dependencies
	modified:         schema_migrations
`;

/** A `dolt status` output indicating a CLEAN working set. */
const CLEAN_STATUS = `On branch main
nothing to commit, working tree clean
`;

const BD_CREATE_OK = "Created issue adj-zzzzz\n";
const BD_CLOSE_OK = "Closed adj-zzzzz\n";

interface ExecCall {
  cmd: string;
  args: string[];
}

/**
 * Build fully-seamed fixBdSchema options + an exec recorder. The exec stub routes by
 * the (cmd, args) shape so a test can choose dirty/clean status and ok/failing writes.
 */
function makeFixOpts(opts: {
  status?: string;
  /** When true, the SECOND bd-create (verify step) returns a failure shape. */
  verifyFails?: boolean;
  overrides?: Partial<FixBdSchemaOptions>;
} = {}): {
  opts: FixBdSchemaOptions;
  execCalls: ExecCall[];
  backup: ReturnType<typeof vi.fn>;
} {
  const status = opts.status ?? DIRTY_STATUS;
  const execCalls: ExecCall[] = [];
  let bdCreateCount = 0;

  const exec = vi.fn(async (cmd: string, args: readonly string[]): Promise<ExecResult> => {
    execCalls.push({ cmd, args: [...args] });

    // dolt status → working-set state
    if (cmd.includes("dolt") && args[0] === "status") {
      return { code: 0, stdout: status, stderr: "" };
    }
    // dolt reset --hard → discards the half-applied migration
    if (cmd.includes("dolt") && args[0] === "reset") {
      return { code: 0, stdout: "", stderr: "" };
    }
    // bd create → the WRITE that applies + commits 0043
    if (cmd.includes("bd") && args[0] === "create") {
      bdCreateCount += 1;
      // The verify-step write (2nd create) fails when verifyFails is set.
      if (opts.verifyFails && bdCreateCount === 2) {
        return {
          code: 1,
          stdout: "",
          stderr:
            "schema migration: pre-existing dirty tables changed during schema migration: dependencies",
        };
      }
      return { code: 0, stdout: BD_CREATE_OK, stderr: "" };
    }
    // bd close → close the throwaway bead
    if (cmd.includes("bd") && args[0] === "close") {
      return { code: 0, stdout: BD_CLOSE_OK, stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  });

  const backup = vi.fn(async () => "/tmp/beads-backup-123");

  const fixOpts: FixBdSchemaOptions = {
    repoDir: REPO_DIR,
    dbName: DB_NAME,
    projectPath: REPO_DIR,
    exec,
    backup,
    ...(opts.overrides ?? {}),
  };

  return { opts: fixOpts, execCalls, backup };
}

describe("fixBdSchema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Happy path: dirty → reset → migrate → verify ok ───────────────────────────
  it("should back up before any mutation on the happy path", async () => {
    const { opts, backup } = makeFixOpts();
    await fixBdSchema(opts);
    expect(backup).toHaveBeenCalledTimes(1);
  });

  it("should reset --hard when the working set is dirty, then migrate-via-write", async () => {
    const { opts, execCalls } = makeFixOpts({ status: DIRTY_STATUS });
    const result = await fixBdSchema(opts);

    const reset = execCalls.find((c) => c.cmd.includes("dolt") && c.args[0] === "reset");
    expect(reset).toBeDefined();
    expect(reset?.args).toContain("--hard");

    // A bd create (write) committed the migration.
    expect(execCalls.some((c) => c.cmd.includes("bd") && c.args[0] === "create")).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("should run the dolt reset against the repo dir (cwd routes to the live server)", async () => {
    // The reset must target the repo dir so the dolt CLI routes to the running
    // supervised sql-server (no stop/start). We assert the repoDir is threaded as the
    // working directory argument the real exec seam will honor.
    const { opts, execCalls } = makeFixOpts({ status: DIRTY_STATUS });
    await fixBdSchema(opts);
    const reset = execCalls.find((c) => c.cmd.includes("dolt") && c.args[0] === "reset");
    // repoDir is passed via the args contract (-C/--cwd style) so it is observable.
    expect(reset?.args.join(" ")).toContain(REPO_DIR);
  });

  it("should report a PASS for the verify step when the second write completes", async () => {
    const { opts } = makeFixOpts({ status: DIRTY_STATUS });
    const result = await fixBdSchema(opts);
    const verify = find(result.results, "verify");
    expect(verify?.status).toBe("pass");
    expect(result.ok).toBe(true);
  });

  it("should order steps backup → reset → migrate → verify", async () => {
    const { opts, execCalls } = makeFixOpts({ status: DIRTY_STATUS });
    await fixBdSchema(opts);
    const idxStatus = execCalls.findIndex((c) => c.args[0] === "status");
    const idxReset = execCalls.findIndex((c) => c.args[0] === "reset");
    const idxFirstCreate = execCalls.findIndex((c) => c.cmd.includes("bd") && c.args[0] === "create");
    expect(idxStatus).toBeLessThan(idxReset);
    expect(idxReset).toBeLessThan(idxFirstCreate);
  });

  // ── Idempotent: already clean → no reset ──────────────────────────────────────
  it("should SKIP the reset when the working set is already clean (idempotent)", async () => {
    const { opts, execCalls } = makeFixOpts({ status: CLEAN_STATUS });
    const result = await fixBdSchema(opts);
    const reset = execCalls.find((c) => c.cmd.includes("dolt") && c.args[0] === "reset");
    expect(reset).toBeUndefined();
    // The verify-via-write still runs and passes.
    expect(result.ok).toBe(true);
    const verify = find(result.results, "verify");
    expect(verify?.status).toBe("pass");
  });

  it("should still back up on the already-clean idempotent path", async () => {
    const { opts, backup } = makeFixOpts({ status: CLEAN_STATUS });
    await fixBdSchema(opts);
    expect(backup).toHaveBeenCalledTimes(1);
  });

  it("should report the reset step as info/skip when nothing was dirty", async () => {
    const { opts } = makeFixOpts({ status: CLEAN_STATUS });
    const result = await fixBdSchema(opts);
    const reset = find(result.results, "reset");
    expect(reset?.status === "info" || reset?.status === "skip").toBe(true);
  });

  // ── Verify-fails path ─────────────────────────────────────────────────────────
  it("should report a FAIL and ok=false when the verify write does not complete", async () => {
    const { opts } = makeFixOpts({ status: DIRTY_STATUS, verifyFails: true });
    const result = await fixBdSchema(opts);
    expect(result.ok).toBe(false);
    const verify = find(result.results, "verify");
    expect(verify?.status).toBe("fail");
  });

  it("should surface the dirty-tables error text in the verify FAIL message", async () => {
    const { opts } = makeFixOpts({ status: DIRTY_STATUS, verifyFails: true });
    const result = await fixBdSchema(opts);
    const verify = find(result.results, "verify");
    expect(verify?.message ?? "").toMatch(/dirty tables/i);
  });

  // ── Step results shape ────────────────────────────────────────────────────────
  it("should return a CheckResult for each of backup, reset, migrate, verify", async () => {
    const { opts } = makeFixOpts({ status: DIRTY_STATUS });
    const result = await fixBdSchema(opts);
    expect(find(result.results, "backup")).toBeDefined();
    expect(find(result.results, "reset")).toBeDefined();
    expect(find(result.results, "migrate")).toBeDefined();
    expect(find(result.results, "verify")).toBeDefined();
  });
});
