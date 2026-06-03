/**
 * Tests for Dolt auto-commit on the supervised server (adj-182.2.6, raynor addendum B).
 *
 * WHY: Dolt's SQL-server `behavior.autocommit` defaults OFF. With it off, `bd create`/
 * `bd update` land in the working set and are INVISIBLE to `bd list` (which reads HEAD)
 * until a manual `bd dolt commit`. This bit the team live (adj-181's 32 beads, and again
 * while wiring adj-182). The supervised server's generated `.beads/dolt/config.yaml` MUST
 * therefore set `behavior.autocommit: true` so every write is immediately HEAD-visible.
 *
 * The fix rides on the SAME targeted-edit write as the port pin (`pinDoltPort`): they
 * touch the same config.yaml, so enabling autocommit there guarantees the supervised
 * server (the only caller, via installSupervisor) always gets it — with no separate seam.
 *
 * Contract (mirrors the port-pin guarantees):
 *  - TARGETED edit — never run config.yaml through a YAML serializer (it strips the
 *    comment-heavy template and reorders keys). Comments are preserved verbatim.
 *  - Idempotent — re-running yields a byte-identical file.
 *  - HEAD visibility — with autocommit on, a written value is visible via a HEAD read
 *    (asserted at the dolt/bd seam with a mock that models autocommit semantics).
 *
 * SAFETY: every test operates on a TEMP .beads directory built per-test. These tests
 * MUST NEVER touch the live `.beads/` or the live server, and never delete `.dolt/**`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { pinDoltPort } from "../../../cli/lib/dolt-pin.js";

/**
 * The relevant slice of the real dolt config.yaml template: the entire `behavior:`
 * block ships COMMENTED OUT (so Dolt's own default — autocommit OFF — applies), with a
 * misleading `# autocommit: true` suggestion line that is NOT active. The active block
 * is `listener:`. There are commented `autocommit`/`behavior` tokens we must not be
 * fooled by.
 */
const REAL_TEMPLATE = `# Dolt SQL server configuration
#
# Uncomment and edit lines as necessary to modify your configuration.

# log_level: info

# behavior:
  # read_only: false
  # autocommit: true
  # disable_client_multi_statements: false
  # dolt_transaction_commit: false

listener:
  host: 127.0.0.1
  port: 49599
  # max_connections: 1000

# data_dir: .
`;

/** Count uncommented (active) `autocommit:` lines in a YAML blob. */
function activeAutocommitLines(yaml: string): string[] {
  return yaml.split("\n").filter((l) => /^\s*autocommit:\s*\S+/.test(l));
}

/**
 * Count uncommented (active) top-level `behavior:` keys — BOTH block style (`behavior:`)
 * and flow style (`behavior: {…}`). adj-182.2.6.r1: the original helper only matched
 * block style, masking a duplicate flow-style key the appended block would create.
 */
function activeBehaviorKeys(yaml: string): string[] {
  return yaml.split("\n").filter((l) => /^behavior:\s*(\{.*\}\s*)?$/.test(l));
}

describe("cli/lib/dolt-pin — supervised autocommit (adj-182.2.6)", () => {
  let tmpDir: string;
  let beadsDir: string;
  let metadataPath: string;
  let configPath: string;

  function seedBeads(metadata: Record<string, unknown>, configYaml: string): void {
    mkdirSync(join(beadsDir, "dolt"), { recursive: true });
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
    writeFileSync(configPath, configYaml, "utf-8");
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "dolt-autocommit-"));
    beadsDir = join(tmpDir, ".beads");
    metadataPath = join(beadsDir, "metadata.json");
    configPath = join(beadsDir, "dolt", "config.yaml");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("writing the supervised config enables autocommit", () => {
    it("should set an ACTIVE behavior.autocommit: true when the template ships it commented", () => {
      seedBeads({ database: "dolt" }, REAL_TEMPLATE);

      pinDoltPort(beadsDir, 17005);

      const cfg = readFileSync(configPath, "utf-8");
      // Exactly one ACTIVE autocommit line, set to true. The commented suggestion
      // line in the template must not be counted as active.
      const active = activeAutocommitLines(cfg);
      expect(active).toHaveLength(1);
      expect(active[0]).toMatch(/^\s*autocommit:\s*true\s*$/);
      // It lives under an active behavior: block.
      expect(activeBehaviorKeys(cfg)).toHaveLength(1);
    });

    it("should preserve the comment-heavy template verbatim (targeted edit, no serializer)", () => {
      seedBeads({ database: "dolt" }, REAL_TEMPLATE);

      pinDoltPort(beadsDir, 17005);

      const cfg = readFileSync(configPath, "utf-8");
      // Header + surrounding comments survive untouched.
      expect(cfg).toContain("# Dolt SQL server configuration");
      expect(cfg).toContain("# Uncomment and edit lines as necessary to modify your configuration.");
      expect(cfg).toContain("# log_level: info");
      expect(cfg).toContain("# data_dir: .");
      // The commented behavior template lines are NOT mutated.
      expect(cfg).toContain("# read_only: false");
      expect(cfg).toContain("# dolt_transaction_commit: false");
      // The listener block (and its port pin) still works alongside autocommit.
      expect(cfg).toMatch(/listener:\s*\n\s*host: 127\.0\.0\.1\s*\n\s*port: 17005/);
    });

    it("should be idempotent — re-running yields a byte-identical config (no stacked behavior blocks)", () => {
      seedBeads({ database: "dolt" }, REAL_TEMPLATE);

      pinDoltPort(beadsDir, 17005);
      const afterFirst = readFileSync(configPath, "utf-8");
      pinDoltPort(beadsDir, 17005);
      const afterSecond = readFileSync(configPath, "utf-8");

      expect(afterSecond).toBe(afterFirst);
      // No duplicate behavior block, no duplicate autocommit line.
      expect(activeBehaviorKeys(afterSecond)).toHaveLength(1);
      expect(activeAutocommitLines(afterSecond)).toHaveLength(1);
    });

    it("should rewrite an existing ACTIVE behavior.autocommit: false to true", () => {
      const withFalse = `# header
behavior:
  autocommit: false
  read_only: false

listener:
  host: 127.0.0.1
  port: 49599
`;
      seedBeads({ database: "dolt" }, withFalse);

      pinDoltPort(beadsDir, 17005);

      const cfg = readFileSync(configPath, "utf-8");
      const active = activeAutocommitLines(cfg);
      expect(active).toHaveLength(1);
      expect(active[0]).toMatch(/^\s*autocommit:\s*true\s*$/);
      // The sibling active key is preserved; no second behavior block appended.
      expect(cfg).toContain("read_only: false");
      expect(activeBehaviorKeys(cfg)).toHaveLength(1);
    });

    it("should insert autocommit under an existing ACTIVE behavior block that lacks it", () => {
      const withoutAutocommit = `behavior:
  read_only: false

listener:
  host: 127.0.0.1
  port: 49599
`;
      seedBeads({ database: "dolt" }, withoutAutocommit);

      pinDoltPort(beadsDir, 17005);

      const cfg = readFileSync(configPath, "utf-8");
      const active = activeAutocommitLines(cfg);
      expect(active).toHaveLength(1);
      expect(active[0]).toMatch(/^\s*autocommit:\s*true\s*$/);
      expect(cfg).toContain("read_only: false");
      expect(activeBehaviorKeys(cfg)).toHaveLength(1);
    });

    it("should preserve a trailing inline comment when flipping autocommit false -> true", () => {
      const annotated = `behavior:
  autocommit: false # set by operator
listener:
  host: 127.0.0.1
  port: 49599
`;
      seedBeads({ database: "dolt" }, annotated);

      pinDoltPort(beadsDir, 17005);

      const cfg = readFileSync(configPath, "utf-8");
      expect(cfg).toMatch(/^\s*autocommit:\s*true\s+# set by operator$/m);
    });

    // ── adj-182.2.6.r1: flow-style behavior block parity ────────────────────────
    it("should flip a FLOW-style behavior: {autocommit: false} to true in place (no duplicate block)", () => {
      const flow = `# header
behavior: {autocommit: false}

listener:
  host: 127.0.0.1
  port: 49599
`;
      seedBeads({ database: "dolt" }, flow);

      pinDoltPort(beadsDir, 17005);

      const cfg = readFileSync(configPath, "utf-8");
      // The flow line is edited in place to true (autocommit lives inside the braces, so
      // there is no standalone `autocommit:` line — assert on the flow line itself).
      expect(cfg).toMatch(/^behavior:\s*\{[^}]*autocommit:\s*true[^}]*\}\s*$/m);
      // No `autocommit: false` survives anywhere.
      expect(cfg).not.toMatch(/autocommit:\s*false/);
      // No second behavior block appended (block OR flow style).
      expect(activeBehaviorKeys(cfg)).toHaveLength(1);
    });

    it("should inject autocommit into a FLOW-style behavior block that lacks it", () => {
      const flowNoAc = `behavior: {read_only: false}
listener:
  host: 127.0.0.1
  port: 49599
`;
      seedBeads({ database: "dolt" }, flowNoAc);

      pinDoltPort(beadsDir, 17005);

      const cfg = readFileSync(configPath, "utf-8");
      expect(cfg).toMatch(/^behavior:\s*\{[^}]*read_only:\s*false[^}]*autocommit:\s*true[^}]*\}\s*$/m);
      expect(activeBehaviorKeys(cfg)).toHaveLength(1);
    });

    it("should be idempotent after appending a behavior block on re-pin (no stacking on the template path)", () => {
      // Template ships behavior commented out → first pin APPENDS an active block. A
      // second pin must EDIT that appended block, not append another.
      seedBeads({ database: "dolt" }, REAL_TEMPLATE);
      pinDoltPort(beadsDir, 17005);
      const afterFirst = readFileSync(configPath, "utf-8");
      pinDoltPort(beadsDir, 17005);
      const afterSecond = readFileSync(configPath, "utf-8");
      expect(afterSecond).toBe(afterFirst);
      expect(activeBehaviorKeys(afterSecond)).toHaveLength(1);
      expect(activeAutocommitLines(afterSecond)).toHaveLength(1);
    });

    it("should be idempotent re-pinning a FLOW-style behavior block", () => {
      const flow = `behavior: {autocommit: false}
listener:
  host: 127.0.0.1
  port: 49599
`;
      seedBeads({ database: "dolt" }, flow);
      pinDoltPort(beadsDir, 17005);
      const afterFirst = readFileSync(configPath, "utf-8");
      pinDoltPort(beadsDir, 17005);
      const afterSecond = readFileSync(configPath, "utf-8");
      expect(afterSecond).toBe(afterFirst);
      expect(activeBehaviorKeys(afterSecond)).toHaveLength(1);
    });

    // ── adj-182.2.6.r1: indent inference on insert ──────────────────────────────
    it("should match the block's child indent when inserting autocommit (4-space hand-edited block)", () => {
      const fourSpace = `behavior:
    read_only: false
listener:
  host: 127.0.0.1
  port: 49599
`;
      seedBeads({ database: "dolt" }, fourSpace);

      pinDoltPort(beadsDir, 17005);

      const cfg = readFileSync(configPath, "utf-8");
      // The inserted autocommit must use the SAME 4-space indent as the existing child,
      // not a hardcoded 2 — a mis-indented sibling would misparse as a new top-level key.
      expect(cfg).toMatch(/^ {4}autocommit:\s*true$/m);
      expect(cfg).toMatch(/^ {4}read_only:\s*false$/m);
      expect(activeAutocommitLines(cfg)).toHaveLength(1);
    });
  });

  /**
   * Higher-level assertion: with autocommit ON, a written value is HEAD-visible.
   *
   * We model the dolt/bd seam: a working-set write is only reflected in a HEAD read
   * when autocommit is on (otherwise it stays in the working set until a manual commit).
   * The config produced by pinDoltPort drives that flag — proving the wiring closes the
   * "invisible until manual commit" gap that bit adj-181/adj-182.
   */
  describe("HEAD visibility under autocommit (dolt/bd seam, mocked)", () => {
    /** Parse the active autocommit flag out of a config.yaml blob. */
    function readAutocommit(yaml: string): boolean {
      const line = activeAutocommitLines(yaml)[0];
      return line ? /:\s*true\s*$/.test(line) : false;
    }

    /** A tiny model of Dolt working-set vs HEAD with autocommit semantics. */
    class FakeDolt {
      private head = new Map<string, string>();
      private working = new Map<string, string>();
      constructor(private autocommit: boolean) {}
      write(key: string, value: string): void {
        this.working.set(key, value);
        if (this.autocommit) this.head.set(key, value); // commit rides the write
      }
      /** `bd list` reads HEAD. */
      readHead(key: string): string | undefined {
        return this.head.get(key);
      }
      commit(): void {
        for (const [k, v] of this.working) this.head.set(k, v);
      }
    }

    it("should make a written value HEAD-visible when the supervised config enables autocommit", () => {
      seedBeads({ database: "dolt" }, REAL_TEMPLATE);
      pinDoltPort(beadsDir, 17005);

      const cfg = readFileSync(configPath, "utf-8");
      const dolt = new FakeDolt(readAutocommit(cfg));

      // Simulate `bd create` writing a bead, then `bd list` reading HEAD.
      dolt.write("adj-999", "open");
      expect(dolt.readHead("adj-999")).toBe("open");
    });

    it("should NOT be HEAD-visible (regression baseline) when autocommit is off", () => {
      // Baseline: a config WITHOUT autocommit leaves writes in the working set.
      const dolt = new FakeDolt(false);
      dolt.write("adj-999", "open");
      expect(dolt.readHead("adj-999")).toBeUndefined();
      // Only a manual commit surfaces it — exactly the manual `bd dolt commit` step
      // that autocommit eliminates.
      dolt.commit();
      expect(dolt.readHead("adj-999")).toBe("open");
    });
  });
});
