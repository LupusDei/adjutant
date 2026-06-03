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
  });
});
