/**
 * Tests for cli/commands/init.ts project-registration (adj-125).
 *
 * `adjutant init` must register the repo with the backend (POST /api/projects) so a
 * freshly-init'd project appears in the dashboard without a manual step — and must
 * NEVER silently skip: a down/garbled backend has to surface loudly. These tests pin
 * the success, idempotent, error, and unreachable-backend paths, plus the .mcp.json
 * origin parsing.
 */

import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  registerProject,
  backendOriginFromMcpJson,
  type PostJsonFn,
} from "../commands/init.js";

const ORIGIN = "http://localhost:4201";
const ROOT = "/Users/Reason/code/ai/demo";
const NAME = "demo";

describe("registerProject (adj-125)", () => {
  it("returns created and includes the new id when the backend responds 201", async () => {
    // Real shape: POST /api/projects returns the standard ApiResponse envelope
    // `success(result.data)` = { success, data: { id, ... }, timestamp } — id under `data`.
    const postJson: PostJsonFn = vi.fn(async () => ({
      status: 201,
      body: { success: true, data: { id: "3ba5667d", name: NAME, path: ROOT }, timestamp: "t" },
    }));

    const result = await registerProject(ROOT, { backendOrigin: ORIGIN, projectName: NAME, postJson });

    expect(result.status).toBe("created");
    expect(result.message).toContain(NAME);
    expect(result.message).toContain("3ba5667d");
    // Posts { path, name } to the /api/projects endpoint on the parsed origin.
    expect(postJson).toHaveBeenCalledWith("http://localhost:4201/api/projects", {
      path: ROOT,
      name: NAME,
    });
  });

  it("also tolerates a raw { id } body (no envelope)", async () => {
    const postJson: PostJsonFn = vi.fn(async () => ({ status: 201, body: { id: "abc123" } }));

    const result = await registerProject(ROOT, { backendOrigin: ORIGIN, projectName: NAME, postJson });

    expect(result.status).toBe("created");
    expect(result.message).toContain("abc123");
  });

  it("treats 409 CONFLICT as success (idempotent re-init), not an error", async () => {
    const postJson: PostJsonFn = vi.fn(async () => ({ status: 409, body: { error: "exists" } }));

    const result = await registerProject(ROOT, { backendOrigin: ORIGIN, projectName: NAME, postJson });

    expect(result.status).toBe("skipped");
    expect(result.message).toContain("already registered");
  });

  it("fails on an unexpected backend status", async () => {
    const postJson: PostJsonFn = vi.fn(async () => ({ status: 500, body: null }));

    const result = await registerProject(ROOT, { backendOrigin: ORIGIN, projectName: NAME, postJson });

    expect(result.status).toBe("fail");
    expect(result.message).toContain("500");
  });

  it("WARNS LOUDLY (never a silent skip) with the manual curl when the backend is unreachable", async () => {
    const postJson: PostJsonFn = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });

    const result = await registerProject(ROOT, { backendOrigin: ORIGIN, projectName: NAME, postJson });

    expect(result.status).toBe("warn");
    expect(result.message).toContain("not reachable");
    // The exact manual fallback must be named so the user is never left guessing.
    expect(result.message).toContain("curl -X POST http://localhost:4201/api/projects");
    expect(result.message).toContain(`"path":"${ROOT}"`);
  });

  it("normalizes a trailing slash on the backend origin", async () => {
    const postJson: PostJsonFn = vi.fn(async () => ({ status: 201, body: { id: "x" } }));

    await registerProject(ROOT, { backendOrigin: "http://localhost:4201/", projectName: NAME, postJson });

    expect(postJson).toHaveBeenCalledWith("http://localhost:4201/api/projects", expect.anything());
  });
});

describe("backendOriginFromMcpJson (adj-125)", () => {
  function withTempMcp(contents: string | null): string {
    const dir = mkdtempSync(join(tmpdir(), "adj-mcp-"));
    if (contents !== null) writeFileSync(join(dir, ".mcp.json"), contents, "utf-8");
    return dir;
  }

  it("extracts the origin from the adjutant server url", () => {
    const dir = withTempMcp(
      JSON.stringify({ mcpServers: { adjutant: { url: "http://localhost:4201/mcp" } } }),
    );
    try {
      expect(backendOriginFromMcpJson(dir)).toBe("http://localhost:4201");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("honors a customized (non-default) port", () => {
    const dir = withTempMcp(
      JSON.stringify({ mcpServers: { adjutant: { url: "http://127.0.0.1:9999/mcp" } } }),
    );
    try {
      expect(backendOriginFromMcpJson(dir)).toBe("http://127.0.0.1:9999");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when .mcp.json is missing or has no adjutant url", () => {
    const missing = withTempMcp(null);
    const noAdjutant = withTempMcp(JSON.stringify({ mcpServers: {} }));
    try {
      expect(backendOriginFromMcpJson(missing)).toBeNull();
      expect(backendOriginFromMcpJson(noAdjutant)).toBeNull();
    } finally {
      rmSync(missing, { recursive: true, force: true });
      rmSync(noAdjutant, { recursive: true, force: true });
    }
  });
});
