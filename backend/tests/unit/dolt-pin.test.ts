/**
 * Tests for the Dolt pin writer (adj-182.1.2, tasks T002a/b).
 *
 * `pinDoltPort(beadsDir, port)` writes the pinned port into the THREE places beads
 * actually reads (plan §1): `.beads/metadata.json` (`dolt_server_port`),
 * `.beads/dolt/config.yaml` (`listener.port`), and returns the
 * `BEADS_DOLT_SERVER_PORT=<port>` env export line. It MUST preserve every other key
 * (and, critically, the comment-heavy dolt config template). Idempotent.
 *
 * SAFETY: every test operates on a TEMP .beads directory built per-test. These tests
 * MUST NEVER touch the live `.beads/`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { pinDoltPort } from "../../../cli/lib/dolt-pin.js";

/** A realistic slice of the dolt config.yaml template: an active listener block
 * surrounded by commented keys, plus other (commented) port: lines elsewhere that
 * MUST NOT be rewritten. */
const CONFIG_TEMPLATE = `# Dolt SQL server configuration

# log_level: info

listener:
  host: 127.0.0.1
  port: 49599
  # max_connections: 1000
  # back_log: 50

# data_dir: .

# remotesapi:
  # port: 8000

# metrics:
  # host: localhost
  # port: 9091
`;

describe("cli/lib/dolt-pin", () => {
  let tmpDir: string;
  let beadsDir: string;
  let metadataPath: string;
  let configPath: string;

  /** Create a temp .beads dir with the given metadata + config contents. */
  function seedBeads(metadata: Record<string, unknown>, configYaml: string): void {
    mkdirSync(join(beadsDir, "dolt"), { recursive: true });
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
    writeFileSync(configPath, configYaml, "utf-8");
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "dolt-pin-"));
    beadsDir = join(tmpDir, ".beads");
    metadataPath = join(beadsDir, "metadata.json");
    configPath = join(beadsDir, "dolt", "config.yaml");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("dolt-server.port file (adj-182.3.11)", () => {
    const portFilePath = () => join(beadsDir, "dolt-server.port");

    it("should write the pinned port into the authoritative dolt-server.port file", () => {
      seedBeads({ database: "dolt", backend: "dolt" }, CONFIG_TEMPLATE);

      pinDoltPort(beadsDir, 17005);

      // bd 1.0.4+ reads this file as the AUTHORITATIVE port (metadata is deprecated).
      // Pinning metadata/config alone left bd dialing a stale port after a churn.
      expect(existsSync(portFilePath())).toBe(true);
      expect(readFileSync(portFilePath(), "utf-8")).toBe("17005");
    });

    it("should write the bare integer with no trailing newline (matches bd's format)", () => {
      seedBeads({ database: "dolt", backend: "dolt" }, CONFIG_TEMPLATE);

      pinDoltPort(beadsDir, 17042);

      const raw = readFileSync(portFilePath(), "utf-8");
      expect(raw).toBe("17042");
      expect(raw.endsWith("\n")).toBe(false);
    });

    it("should be idempotent — re-pinning the same port yields a byte-identical port file", () => {
      seedBeads({ database: "dolt", backend: "dolt" }, CONFIG_TEMPLATE);

      pinDoltPort(beadsDir, 17005);
      const first = readFileSync(portFilePath(), "utf-8");
      pinDoltPort(beadsDir, 17005);
      const second = readFileSync(portFilePath(), "utf-8");

      expect(second).toBe(first);
    });
  });

  describe("metadata.json", () => {
    it("should write dolt_server_port into metadata.json", () => {
      seedBeads({ database: "dolt", backend: "dolt" }, CONFIG_TEMPLATE);

      pinDoltPort(beadsDir, 17005);

      const meta = JSON.parse(readFileSync(metadataPath, "utf-8")) as Record<string, unknown>;
      expect(meta["dolt_server_port"]).toBe(17005);
    });

    it("should preserve all other metadata.json keys", () => {
      seedBeads(
        { database: "dolt", backend: "dolt", dolt_database: "beads_adj", project_id: "abc-123" },
        CONFIG_TEMPLATE,
      );

      pinDoltPort(beadsDir, 17005);

      const meta = JSON.parse(readFileSync(metadataPath, "utf-8")) as Record<string, unknown>;
      expect(meta).toMatchObject({
        database: "dolt",
        backend: "dolt",
        dolt_database: "beads_adj",
        project_id: "abc-123",
        dolt_server_port: 17005,
      });
    });

    it("should overwrite an existing dolt_server_port (re-pin)", () => {
      seedBeads({ database: "dolt", dolt_server_port: 49599 }, CONFIG_TEMPLATE);

      pinDoltPort(beadsDir, 17005);

      const meta = JSON.parse(readFileSync(metadataPath, "utf-8")) as Record<string, unknown>;
      expect(meta["dolt_server_port"]).toBe(17005);
    });
  });

  describe("dolt/config.yaml", () => {
    it("should set listener.port to the pinned port", () => {
      seedBeads({ database: "dolt" }, CONFIG_TEMPLATE);

      pinDoltPort(beadsDir, 17005);

      const cfg = readFileSync(configPath, "utf-8");
      // The active listener port line is rewritten.
      expect(cfg).toMatch(/listener:\s*\n\s*host: 127\.0\.0\.1\s*\n\s*port: 17005/);
    });

    it("should preserve the host and surrounding comments in the listener block", () => {
      seedBeads({ database: "dolt" }, CONFIG_TEMPLATE);

      pinDoltPort(beadsDir, 17005);

      const cfg = readFileSync(configPath, "utf-8");
      expect(cfg).toContain("host: 127.0.0.1");
      expect(cfg).toContain("# max_connections: 1000");
      expect(cfg).toContain("# Dolt SQL server configuration");
    });

    it("should NOT rewrite commented port lines elsewhere (remotesapi/metrics)", () => {
      seedBeads({ database: "dolt" }, CONFIG_TEMPLATE);

      pinDoltPort(beadsDir, 17005);

      const cfg = readFileSync(configPath, "utf-8");
      // Other (commented) port lines stay exactly as-is.
      expect(cfg).toContain("# port: 8000");
      expect(cfg).toContain("# port: 9091");
      // Exactly ONE uncommented "port:" line should remain (the listener one).
      const activePortLines = cfg
        .split("\n")
        .filter((l) => /^\s*port:\s*\d+/.test(l));
      expect(activePortLines).toHaveLength(1);
      expect(activePortLines[0]).toContain("17005");
    });

    // ── adj-182.1.2.1: re-pin must PRESERVE a trailing inline comment on the port line ──
    //
    // applyListenerPort rewrote the line as `${indent}port: ${port}`, DROPPING any
    // trailing `# ...` comment. The first pin of a clean template is fine (no comment),
    // so this bites the live-cutover RE-PIN path and operator-annotated configs.
    it("should preserve a trailing inline comment on the active port line when re-pinning", () => {
      const annotated = "listener:\n  host: 127.0.0.1\n  port: 1 # keep\n";
      seedBeads({ database: "dolt" }, annotated);

      pinDoltPort(beadsDir, 17005);

      const cfg = readFileSync(configPath, "utf-8");
      // Port updated, comment retained verbatim.
      expect(cfg).toMatch(/^\s*port: 17005\s+# keep$/m);
    });

    it("should preserve a multi-word trailing comment with extra spacing on re-pin", () => {
      const annotated =
        "listener:\n  host: 127.0.0.1\n  port: 49599   # pinned by adjutant (adj-182)\n";
      seedBeads({ database: "dolt" }, annotated);

      pinDoltPort(beadsDir, 17009);

      const cfg = readFileSync(configPath, "utf-8");
      expect(cfg).toContain("port: 17009");
      expect(cfg).toContain("# pinned by adjutant (adj-182)");
      // The old port value is gone.
      expect(cfg).not.toContain("49599");
    });

    it("should add a listener block when the config has none", () => {
      seedBeads({ database: "dolt" }, "# Dolt SQL server configuration\n\n# log_level: info\n");

      pinDoltPort(beadsDir, 17005);

      const cfg = readFileSync(configPath, "utf-8");
      expect(cfg).toMatch(/listener:\s*\n\s*host: 127\.0\.0\.1\s*\n\s*port: 17005/);
      // Original content preserved.
      expect(cfg).toContain("# Dolt SQL server configuration");
    });

    it("should create dolt/config.yaml if it is missing", () => {
      // metadata exists, but no config.yaml yet.
      mkdirSync(beadsDir, { recursive: true });
      writeFileSync(metadataPath, JSON.stringify({ database: "dolt" }, null, 2), "utf-8");
      expect(existsSync(configPath)).toBe(false);

      pinDoltPort(beadsDir, 17005);

      expect(existsSync(configPath)).toBe(true);
      const cfg = readFileSync(configPath, "utf-8");
      expect(cfg).toMatch(/listener:\s*\n\s*host: 127\.0\.0\.1\s*\n\s*port: 17005/);
    });
  });

  describe("return value (env export line)", () => {
    it("should return the BEADS_DOLT_SERVER_PORT export line", () => {
      seedBeads({ database: "dolt" }, CONFIG_TEMPLATE);

      const result = pinDoltPort(beadsDir, 17005);

      expect(result).toBe("BEADS_DOLT_SERVER_PORT=17005");
    });
  });

  describe("idempotency", () => {
    it("should produce identical files and return value when run twice", () => {
      seedBeads(
        { database: "dolt", backend: "dolt", project_id: "abc" },
        CONFIG_TEMPLATE,
      );

      const first = pinDoltPort(beadsDir, 17005);
      const metaAfterFirst = readFileSync(metadataPath, "utf-8");
      const cfgAfterFirst = readFileSync(configPath, "utf-8");

      const second = pinDoltPort(beadsDir, 17005);
      const metaAfterSecond = readFileSync(metadataPath, "utf-8");
      const cfgAfterSecond = readFileSync(configPath, "utf-8");

      expect(second).toBe(first);
      expect(metaAfterSecond).toBe(metaAfterFirst);
      expect(cfgAfterSecond).toBe(cfgAfterFirst);
    });
  });

  describe("error path", () => {
    it("should throw when the beads dir does not exist", () => {
      // Nothing seeded — beadsDir absent.
      expect(existsSync(beadsDir)).toBe(false);
      expect(() => pinDoltPort(beadsDir, 17005)).toThrow();
    });

    it("should throw on a port outside the reserved band", () => {
      seedBeads({ database: "dolt" }, CONFIG_TEMPLATE);
      expect(() => pinDoltPort(beadsDir, 80)).toThrow(/band|17000|17999/i);
    });

    // ── adj-182.1.review.1: pinMetadata must reject non-object metadata.json ──
    //
    // pinMetadata JSON.parsed metadata.json but never asserted a plain object:
    //  (a) a JSON ARRAY → `arr["dolt_server_port"] = port` is silently dropped by
    //      JSON.stringify, so pinDoltPort returns success while the port never lands,
    //      leaving beads self-managed (the churn this epic exists to kill).
    //  (b) a JSON SCALAR (null/number) → a raw TypeError escapes instead of the
    //      module's clean wrapped "Dolt pin: ..." error.
    // Fix: assert plain object after parse; throw a clear wrapped error otherwise.
    it("should throw a clear error when metadata.json is a JSON array (not silently drop the port)", () => {
      // Seed a metadata.json whose top-level value is an array.
      mkdirSync(join(beadsDir, "dolt"), { recursive: true });
      writeFileSync(metadataPath, JSON.stringify([], null, 2), "utf-8");
      writeFileSync(configPath, CONFIG_TEMPLATE, "utf-8");

      expect(() => pinDoltPort(beadsDir, 17005)).toThrow(/Dolt pin:.*metadata\.json|expected a JSON object/i);

      // And critically: the port must NOT have been silently written anywhere.
      const raw = readFileSync(metadataPath, "utf-8");
      expect(raw).not.toContain("dolt_server_port");
    });

    it("should throw a clear wrapped error when metadata.json is a JSON scalar", () => {
      mkdirSync(join(beadsDir, "dolt"), { recursive: true });
      writeFileSync(metadataPath, "42", "utf-8");
      writeFileSync(configPath, CONFIG_TEMPLATE, "utf-8");

      // A clean wrapped "Dolt pin: ..." error, NOT a raw TypeError.
      expect(() => pinDoltPort(beadsDir, 17005)).toThrow(/Dolt pin:/);
    });
  });

  // ── adj-182.1.2.2: flow-style `listener: {..}` must be detected & edited in place ──
  //
  // The detector `/^listener:\s*$/` only matched a block-style header on its own line,
  // so a flow-style `listener: {host: 127.0.0.1, port: 49599}` was NOT matched and a
  // SECOND `listener:` block got appended (two top-level listener keys — ambiguous YAML).
  describe("dolt/config.yaml — flow-style listener (adj-182.1.2.2)", () => {
    it("should edit a flow-style listener block in place without appending a second listener", () => {
      const flow = "# Dolt SQL server configuration\nlistener: {host: 127.0.0.1, port: 49599}\n";
      seedBeads({ database: "dolt" }, flow);

      pinDoltPort(beadsDir, 17005);

      const cfg = readFileSync(configPath, "utf-8");
      // The pinned port is present.
      expect(cfg).toContain("17005");
      // The stale port is gone.
      expect(cfg).not.toContain("49599");
      // Exactly ONE top-level listener key — no appended duplicate block.
      const listenerKeys = cfg.split("\n").filter((l) => l.startsWith("listener:"));
      expect(listenerKeys).toHaveLength(1);
    });

    it("should be idempotent on a flow-style listener (re-pin does not stack listener blocks)", () => {
      const flow = "# Dolt SQL server configuration\nlistener: {host: 127.0.0.1, port: 49599}\n";
      seedBeads({ database: "dolt" }, flow);

      pinDoltPort(beadsDir, 17005);
      const afterFirst = readFileSync(configPath, "utf-8");
      pinDoltPort(beadsDir, 17005);
      const afterSecond = readFileSync(configPath, "utf-8");

      expect(afterSecond).toBe(afterFirst);
      const listenerKeys = afterSecond.split("\n").filter((l) => l.startsWith("listener:"));
      expect(listenerKeys).toHaveLength(1);
    });
  });
});
