/**
 * Integration test for path-based Dolt port allocation (adj-182.1.4.1).
 *
 * THE BUG (live cutover 2026-06-03, RC=1 before any server start):
 *   install-dolt-supervisor-cli.ts read `.beads/metadata.json`'s `project_id`
 *   (a beads UUID, e.g. `c249344d-...`) and called allocateDoltPort(uuid). But the
 *   REAL central registry (`~/.adjutant/projects.json`) keys entries by a SHORT id
 *   (e.g. `0e578d15`) plus a `path` field — there is NO UUID anywhere in the file.
 *   allocateDoltPort requires the project to pre-exist under the id it is handed, so
 *   it threw: `Project "c249344d-..." not found in Dolt port registry`.
 *
 * The id-only seam tests (dolt-port-registry.test.ts) all PASSED because each test
 * pre-seeded the registry with the exact id it later allocated for. They never
 * exercised the cross-id-space join the real install performs. This integration
 * test pins the REAL registry shape and the repo-PATH join that bridges the gap.
 *
 * SAFETY: every assertion runs against a TEMP registry file created in a temp dir.
 * It MUST NEVER read or write the real ~/.adjutant/projects.json.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, realpathSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  allocateDoltPortByPath,
  getDoltPort,
  DOLT_PORT_BAND_START,
} from "../../../cli/lib/dolt-port-registry.js";

/**
 * A registry entry mirroring the REAL ~/.adjutant/projects.json shape: an 8-char
 * `id`, a display `name`, an absolute repo `path`, `hasBeads`, and (crucially) NO
 * `doltPort` and NO uuid. This is the shape the seam-only tests never used.
 */
interface RealRegistryProject {
  id: string;
  name: string;
  path: string;
  mode?: string;
  sessions?: unknown[];
  createdAt?: string;
  active?: boolean;
  hasBeads?: boolean;
  doltPort?: number;
}
interface Registry {
  projects: RealRegistryProject[];
}

describe("dolt port allocation by repo path (adj-182.1.4.1 — real registry shape)", () => {
  let tmpDir: string;
  let registryPath: string;
  let repoPath: string;

  function seedRealRegistry(projects: RealRegistryProject[]): void {
    writeFileSync(registryPath, JSON.stringify({ projects }, null, 2) + "\n", "utf-8");
  }

  function readRegistry(): Registry {
    return JSON.parse(readFileSync(registryPath, "utf-8")) as Registry;
  }

  beforeEach(() => {
    // realpathSync so the temp dir is already canonical (macOS aliases /var → /private/var);
    // seeded `path` values then equal what the allocator persists after its own normalization.
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "dolt-port-path-")));
    registryPath = join(tmpDir, "projects.json");
    // A real on-disk repo directory so realpath/resolve normalization has something to bind to.
    repoPath = join(tmpDir, "code", "ai", "adjutant");
    mkdirSync(repoPath, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reproduces the cutover failure mode: a UUID is NOT a key in the real registry", () => {
    // Mirror the real file: short id + path, no uuid, no doltPort.
    seedRealRegistry([
      { id: "0e578d15", name: "adjutant", path: repoPath, hasBeads: true },
    ]);

    // The OLD code did `allocateDoltPort(metadata.project_id)` with the beads UUID —
    // which is not a key here. We assert the registry genuinely lacks that key, so the
    // path-join below is the only thing that can resolve it.
    const reg = readRegistry();
    expect(reg.projects.some((p) => p.id === "c249344d-1d43-4359-a2dd-be8cbb0270e3")).toBe(false);
    expect(reg.projects.some((p) => p.path === repoPath)).toBe(true);
  });

  it("allocates a port by matching the repo PATH to an existing entry and persists doltPort there", () => {
    seedRealRegistry([
      { id: "f1e8f895", name: "ai", path: join(tmpDir, "code", "ai"), hasBeads: true },
      { id: "0e578d15", name: "adjutant", path: repoPath, hasBeads: true },
    ]);

    const port = allocateDoltPortByPath(repoPath, { registryPath });

    expect(port).toBe(DOLT_PORT_BAND_START);
    const rec = readRegistry().projects.find((p) => p.path === repoPath);
    expect(rec?.id).toBe("0e578d15");
    expect(rec?.doltPort).toBe(DOLT_PORT_BAND_START);
    // The matched entry's other fields must be preserved.
    expect(rec).toMatchObject({ id: "0e578d15", name: "adjutant", hasBeads: true });
  });

  it("is idempotent: a second allocate for the same path returns the same port and rewrites nothing new", () => {
    seedRealRegistry([{ id: "0e578d15", name: "adjutant", path: repoPath, hasBeads: true }]);

    const first = allocateDoltPortByPath(repoPath, { registryPath });
    const second = allocateDoltPortByPath(repoPath, { registryPath });

    expect(second).toBe(first);
    const matches = readRegistry().projects.filter((p) => p.path === repoPath);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.doltPort).toBe(first);
  });

  it("normalizes a trailing slash / non-canonical path to the same registry entry", () => {
    seedRealRegistry([{ id: "0e578d15", name: "adjutant", path: repoPath, hasBeads: true }]);

    const port = allocateDoltPortByPath(repoPath + "/", { registryPath });

    expect(port).toBe(DOLT_PORT_BAND_START);
    expect(readRegistry().projects.find((p) => p.path === repoPath)?.doltPort).toBe(
      DOLT_PORT_BAND_START,
    );
  });

  it("is collision-safe across entries: a second project by path gets a distinct port", () => {
    const otherRepo = join(tmpDir, "code", "ai", "OttoDom");
    mkdirSync(otherRepo, { recursive: true });
    seedRealRegistry([
      { id: "0e578d15", name: "adjutant", path: repoPath, hasBeads: true },
      { id: "e8c8fa8e", name: "OttoDom", path: otherRepo, hasBeads: true },
    ]);

    const a = allocateDoltPortByPath(repoPath, { registryPath });
    const b = allocateDoltPortByPath(otherRepo, { registryPath });

    expect(a).toBe(DOLT_PORT_BAND_START);
    expect(b).toBe(DOLT_PORT_BAND_START + 1);
    expect(a).not.toBe(b);
  });

  it("auto-creates a NEW entry (and allocates) only when no entry matches the repo path", () => {
    seedRealRegistry([{ id: "f1e8f895", name: "ai", path: join(tmpDir, "code", "ai"), hasBeads: true }]);
    const fresh = join(tmpDir, "code", "ai", "brand-new-proj");
    mkdirSync(fresh, { recursive: true });

    const port = allocateDoltPortByPath(fresh, { registryPath });

    expect(port).toBe(DOLT_PORT_BAND_START);
    const created = readRegistry().projects.find((p) => p.path === fresh);
    expect(created).toBeDefined();
    expect(created?.doltPort).toBe(DOLT_PORT_BAND_START);
    // The pre-existing entry is untouched.
    const ai = readRegistry().projects.find((p) => p.id === "f1e8f895");
    expect(ai?.doltPort).toBeUndefined();
  });

  it("getDoltPort resolves the persisted port via the matched entry's id after a path allocation", () => {
    seedRealRegistry([{ id: "0e578d15", name: "adjutant", path: repoPath, hasBeads: true }]);

    const port = allocateDoltPortByPath(repoPath, { registryPath });

    // getDoltPort is id-keyed; the matched entry's SHORT id must carry the port.
    expect(getDoltPort("0e578d15", { registryPath })).toBe(port);
  });

  it("throws a clear error when the registry file does not exist", () => {
    expect(existsSync(registryPath)).toBe(false);
    expect(() => allocateDoltPortByPath(repoPath, { registryPath })).toThrow();
  });
});
