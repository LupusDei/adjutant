/**
 * Tests for the Dolt port registry/allocator (adj-182.1.1, tasks T001a/b).
 *
 * The allocator assigns a stable per-project Dolt SQL-server port from a reserved
 * band (17000–17999) and persists it as `doltPort` on the project record inside the
 * central registry (`~/.adjutant/projects.json`). Pinning the port at the source kills
 * the ephemeral-port churn that opens the dolt circuit breaker after sleep/crash.
 *
 * SAFETY: every test injects a TEMP registry path via the DI seam. These tests MUST
 * NEVER read or write the real ~/.adjutant/projects.json.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  allocateDoltPort,
  getDoltPort,
  getDoltPortByPath,
  getRegistryIdByPath,
  DOLT_PORT_BAND_START,
  DOLT_PORT_BAND_END,
} from "../../../cli/lib/dolt-port-registry.js";

interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  hasBeads?: boolean;
  doltPort?: number;
}
interface Registry {
  projects: ProjectRecord[];
}

describe("cli/lib/dolt-port-registry", () => {
  let tmpDir: string;
  let registryPath: string;

  /** Seed the temp registry with the given projects (no doltPort unless specified). */
  function seedRegistry(projects: ProjectRecord[]): void {
    const reg: Registry = { projects };
    writeFileSync(registryPath, JSON.stringify(reg, null, 2), "utf-8");
  }

  function readRegistry(): Registry {
    return JSON.parse(readFileSync(registryPath, "utf-8")) as Registry;
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "dolt-port-registry-"));
    registryPath = join(tmpDir, "projects.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("band constants", () => {
    it("should expose the reserved 17000-17999 band", () => {
      expect(DOLT_PORT_BAND_START).toBe(17000);
      expect(DOLT_PORT_BAND_END).toBe(17999);
    });
  });

  describe("allocateDoltPort — happy path", () => {
    it("should allocate the first-free port in the band when none are taken", () => {
      seedRegistry([{ id: "proj-a", name: "A", path: "/a", hasBeads: true }]);

      const port = allocateDoltPort("proj-a", { registryPath });

      expect(port).toBe(DOLT_PORT_BAND_START);
    });

    it("should persist the allocated port as doltPort on the project record", () => {
      seedRegistry([{ id: "proj-a", name: "A", path: "/a", hasBeads: true }]);

      allocateDoltPort("proj-a", { registryPath });

      const reg = readRegistry();
      const rec = reg.projects.find((p) => p.id === "proj-a");
      expect(rec?.doltPort).toBe(DOLT_PORT_BAND_START);
    });

    it("should preserve all other project fields when persisting the port", () => {
      seedRegistry([
        { id: "proj-a", name: "A", path: "/a", hasBeads: true },
        { id: "proj-b", name: "B", path: "/b", hasBeads: false },
      ]);

      allocateDoltPort("proj-a", { registryPath });

      const reg = readRegistry();
      const a = reg.projects.find((p) => p.id === "proj-a");
      const b = reg.projects.find((p) => p.id === "proj-b");
      expect(a).toMatchObject({ id: "proj-a", name: "A", path: "/a", hasBeads: true });
      // Untouched sibling must be byte-for-byte intact.
      expect(b).toEqual({ id: "proj-b", name: "B", path: "/b", hasBeads: false });
    });
  });

  describe("allocateDoltPort — idempotent re-read", () => {
    it("should return the same port on a second allocate for the same project", () => {
      seedRegistry([{ id: "proj-a", name: "A", path: "/a", hasBeads: true }]);

      const first = allocateDoltPort("proj-a", { registryPath });
      const second = allocateDoltPort("proj-a", { registryPath });

      expect(second).toBe(first);
    });

    it("should not allocate a new port if doltPort is already set", () => {
      seedRegistry([{ id: "proj-a", name: "A", path: "/a", hasBeads: true, doltPort: 17042 }]);

      const port = allocateDoltPort("proj-a", { registryPath });

      expect(port).toBe(17042);
      expect(readRegistry().projects[0]?.doltPort).toBe(17042);
    });
  });

  describe("allocateDoltPort — collision avoidance across two projects", () => {
    it("should give two different projects two distinct ports", () => {
      seedRegistry([
        { id: "proj-a", name: "A", path: "/a", hasBeads: true },
        { id: "proj-b", name: "B", path: "/b", hasBeads: true },
      ]);

      const a = allocateDoltPort("proj-a", { registryPath });
      const b = allocateDoltPort("proj-b", { registryPath });

      expect(a).not.toBe(b);
      expect(a).toBe(DOLT_PORT_BAND_START);
      expect(b).toBe(DOLT_PORT_BAND_START + 1);
    });

    it("should skip a port already taken by another project", () => {
      seedRegistry([
        { id: "proj-a", name: "A", path: "/a", hasBeads: true, doltPort: DOLT_PORT_BAND_START },
        { id: "proj-b", name: "B", path: "/b", hasBeads: true },
      ]);

      const b = allocateDoltPort("proj-b", { registryPath });

      expect(b).toBe(DOLT_PORT_BAND_START + 1);
    });

    it("should fill the lowest free gap rather than always appending", () => {
      // 17000 and 17002 taken; 17001 is the lowest free port.
      seedRegistry([
        { id: "proj-a", name: "A", path: "/a", hasBeads: true, doltPort: 17000 },
        { id: "proj-c", name: "C", path: "/c", hasBeads: true, doltPort: 17002 },
        { id: "proj-b", name: "B", path: "/b", hasBeads: true },
      ]);

      const b = allocateDoltPort("proj-b", { registryPath });

      expect(b).toBe(17001);
    });
  });

  describe("allocateDoltPort — error paths", () => {
    it("should throw when the project id is not in the registry", () => {
      seedRegistry([{ id: "proj-a", name: "A", path: "/a", hasBeads: true }]);

      expect(() => allocateDoltPort("ghost", { registryPath })).toThrow(/ghost/);
    });

    it("should throw when the registry file does not exist", () => {
      // registryPath points at a temp file that was never created.
      expect(existsSync(registryPath)).toBe(false);
      expect(() => allocateDoltPort("proj-a", { registryPath })).toThrow();
    });

    it("should throw a band-exhaustion error when every port in the band is taken", () => {
      const bandSize = DOLT_PORT_BAND_END - DOLT_PORT_BAND_START + 1;
      const projects: ProjectRecord[] = [];
      for (let i = 0; i < bandSize; i++) {
        projects.push({
          id: `taken-${i}`,
          name: `T${i}`,
          path: `/t${i}`,
          hasBeads: true,
          doltPort: DOLT_PORT_BAND_START + i,
        });
      }
      // The project that wants a port — none remain.
      projects.push({ id: "needs-port", name: "N", path: "/n", hasBeads: true });
      seedRegistry(projects);

      expect(() => allocateDoltPort("needs-port", { registryPath })).toThrow(/exhaust/i);
    });
  });

  describe("getDoltPort", () => {
    it("should return the persisted port for a project", () => {
      seedRegistry([{ id: "proj-a", name: "A", path: "/a", hasBeads: true, doltPort: 17123 }]);

      expect(getDoltPort("proj-a", { registryPath })).toBe(17123);
    });

    it("should return null when the project has no doltPort assigned", () => {
      seedRegistry([{ id: "proj-a", name: "A", path: "/a", hasBeads: true }]);

      expect(getDoltPort("proj-a", { registryPath })).toBeNull();
    });

    it("should return null when the project is not in the registry", () => {
      seedRegistry([{ id: "proj-a", name: "A", path: "/a", hasBeads: true }]);

      expect(getDoltPort("ghost", { registryPath })).toBeNull();
    });
  });

  // adj-54n52: the doctor holds only the beads UUID but the registry keys entries by an
  // 8-char short id — so the pin/collision checks MUST resolve by repo PATH, not id.
  describe("getDoltPortByPath", () => {
    it("should return the persisted port for the entry matching the repo path", () => {
      seedRegistry([
        { id: "3ff68bf1", name: "adjutant", path: "/repo/adjutant", hasBeads: true, doltPort: 17000 },
      ]);

      expect(getDoltPortByPath("/repo/adjutant", { registryPath })).toBe(17000);
    });

    it("should return null when the matching entry has no doltPort assigned", () => {
      seedRegistry([{ id: "3ff68bf1", name: "adjutant", path: "/repo/adjutant", hasBeads: true }]);

      expect(getDoltPortByPath("/repo/adjutant", { registryPath })).toBeNull();
    });

    it("should return null when no entry matches the path (and not throw)", () => {
      seedRegistry([{ id: "proj-a", name: "A", path: "/repo/other", hasBeads: true, doltPort: 17001 }]);

      expect(getDoltPortByPath("/repo/adjutant", { registryPath })).toBeNull();
    });

    it("should return null when the registry file is missing (no throw)", () => {
      expect(getDoltPortByPath("/repo/adjutant", { registryPath: join(tmpDir, "nope.json") })).toBeNull();
    });
  });

  describe("getRegistryIdByPath", () => {
    it("should resolve the short registry id for the entry matching the repo path", () => {
      seedRegistry([
        { id: "3ff68bf1", name: "adjutant", path: "/repo/adjutant", hasBeads: true, doltPort: 17000 },
      ]);

      expect(getRegistryIdByPath("/repo/adjutant", { registryPath })).toBe("3ff68bf1");
    });

    it("should return null when no entry matches the path", () => {
      seedRegistry([{ id: "proj-a", name: "A", path: "/repo/other", hasBeads: true }]);

      expect(getRegistryIdByPath("/repo/adjutant", { registryPath })).toBeNull();
    });

    it("should return null when the registry file is missing (no throw)", () => {
      expect(getRegistryIdByPath("/repo/adjutant", { registryPath: join(tmpDir, "nope.json") })).toBeNull();
    });
  });
});
