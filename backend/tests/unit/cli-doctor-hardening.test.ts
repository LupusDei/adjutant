/**
 * Tests for doctor hardening fixes:
 *  - writePlistEnsuringDir (adj-k5g14): `adjutant doctor --fix` must not ENOENT-crash on
 *    a fresh Mac whose ~/Library/LaunchAgents does not exist yet.
 *  - checkDoltVersionCompat (adj-tgthb): WARN when dolt is 2.x (breaks top-level bd create
 *    via same-transaction FK visibility); PASS on the known-good 1.83.x band.
 *
 * SAFETY: writePlistEnsuringDir tests use a TEMP dir via real fs and never touch
 * ~/Library/LaunchAgents. checkDoltVersionCompat is pure (no I/O).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { writePlistEnsuringDir, checkDoltVersionCompat } from "../../../cli/commands/doctor.js";

describe("cli/commands/doctor — writePlistEnsuringDir (adj-k5g14)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "doctor-writeplist-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should create a missing parent directory and write the plist", () => {
    // Simulates a fresh account where ~/Library/LaunchAgents does not exist.
    const plistPath = join(tmpDir, "Library", "LaunchAgents", "com.adjutant.dolt.test.plist");
    expect(existsSync(join(tmpDir, "Library", "LaunchAgents"))).toBe(false);

    writePlistEnsuringDir(plistPath, "<plist>contents</plist>");

    expect(existsSync(plistPath)).toBe(true);
    expect(readFileSync(plistPath, "utf-8")).toBe("<plist>contents</plist>");
  });

  it("should be idempotent when the parent directory already exists", () => {
    const dir = join(tmpDir, "LaunchAgents");
    const plistPath = join(dir, "a.plist");
    writePlistEnsuringDir(plistPath, "first");
    // Second write into the now-existing dir must not throw and must overwrite.
    expect(() => {
      writePlistEnsuringDir(plistPath, "second");
    }).not.toThrow();
    expect(readFileSync(plistPath, "utf-8")).toBe("second");
  });

  it("should create deeply nested missing directories", () => {
    const plistPath = join(tmpDir, "a", "b", "c", "d.plist");
    writePlistEnsuringDir(plistPath, "deep");
    expect(readFileSync(plistPath, "utf-8")).toBe("deep");
  });
});

describe("cli/commands/doctor — checkDoltVersionCompat (adj-tgthb)", () => {
  it("should PASS on the known-good 1.83.x band", () => {
    const res = checkDoltVersionCompat("dolt version 1.83.6");
    expect(res.status).toBe("pass");
    expect(res.message).toContain("1.83.6");
  });

  it("should WARN on dolt 2.x (breaks top-level bd create)", () => {
    const res = checkDoltVersionCompat("dolt version 2.1.7");
    expect(res.status).toBe("warn");
    expect(res.message).toContain("2.1.7");
    expect(res.message).toMatch(/relink dolt < 2\.0/);
  });

  it("should WARN when the version cannot be parsed", () => {
    const res = checkDoltVersionCompat("dolt: command produced no version");
    expect(res.status).toBe("warn");
    expect(res.message).toMatch(/could not parse/);
  });
});
