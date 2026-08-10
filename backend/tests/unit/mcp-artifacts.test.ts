/**
 * adj-j7az6.2.1 — MCP authoring contract for global/personal Artifacts.
 *
 * Covers the `registerArtifactTools` tool handlers:
 *  - create_artifact — success writes an artifact and resolves the CALLING agent as
 *    created_by server-side (never client-supplied); optional `public` auto-publishes and
 *    returns the `/a/<token>` URL; validation error on missing title/html.
 *  - publish_artifact / unpublish_artifact — by id; publish returns the public URL.
 *  - list_artifacts — newest-first previews.
 *
 * Artifacts are a single fleet-wide library (adj-j7az6) — NO project scoping — so the
 * harness only mocks agent identity resolution (getAgentBySession), not project context.
 * The MCP SDK is mocked to capture (name, schema, handler) tuples; handlers are invoked
 * with already-parsed args (mirroring mcp-proposals.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// Mock logger before imports.
vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock mcp-server identity resolution.
const { mockGetAgentBySession } = vi.hoisted(() => ({
  mockGetAgentBySession: vi.fn(),
}));

vi.mock("../../src/services/mcp-server.js", () => ({
  getAgentBySession: mockGetAgentBySession,
}));

// Mock MCP SDK — capture (name, schema, handler) tuples.
const { mockTool, MockMcpServer } = vi.hoisted(() => {
  const mockTool = vi.fn();
  const MockMcpServer = vi.fn().mockImplementation(function () {
    return {
      tool: mockTool,
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      server: {},
    };
  });
  return { mockTool, MockMcpServer };
});

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: MockMcpServer,
}));

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Artifact } from "../../src/types/artifacts.js";
import type { ArtifactStore } from "../../src/services/artifact-store.js";
import { registerArtifactTools } from "../../src/services/mcp-tools/artifacts.js";

// =============================================================================
// Helpers
// =============================================================================

function createMockServer(): McpServer {
  return new MockMcpServer() as unknown as McpServer;
}

const BASE_ARTIFACT: Artifact = {
  id: "art-uuid-1",
  title: "Test Artifact",
  slug: undefined,
  description: "A test artifact",
  html: "<h1>Hi</h1>",
  isPublic: false,
  shareToken: undefined,
  publishedAt: undefined,
  createdBy: "scribe",
  createdAt: "2026-08-10T00:00:00Z",
  updatedAt: "2026-08-10T00:00:00Z",
};

function createMockStore(): ArtifactStore {
  return {
    createArtifact: vi.fn().mockImplementation(
      (input: { title: string; html: string; description?: string; slug?: string; createdBy?: string }) => ({
        ...BASE_ARTIFACT,
        title: input.title,
        html: input.html,
        description: input.description,
        slug: input.slug,
        createdBy: input.createdBy,
      }),
    ),
    getArtifact: vi.fn().mockReturnValue({ ...BASE_ARTIFACT }),
    listArtifacts: vi.fn().mockReturnValue([{ ...BASE_ARTIFACT }]),
    updateArtifact: vi.fn().mockReturnValue({ ...BASE_ARTIFACT }),
    deleteArtifact: vi.fn().mockReturnValue(true),
    publishArtifact: vi.fn().mockImplementation((id: string) => ({
      ...BASE_ARTIFACT,
      id,
      isPublic: true,
      shareToken: "TOKENabc123456789",
      publishedAt: "2026-08-10T01:00:00Z",
    })),
    unpublishArtifact: vi.fn().mockImplementation((id: string) => ({
      ...BASE_ARTIFACT,
      id,
      isPublic: false,
      shareToken: "TOKENabc123456789",
    })),
    getArtifactByToken: vi.fn().mockReturnValue(null),
  };
}

function getToolHandler(store: ArtifactStore, toolName: string): (...args: unknown[]) => Promise<unknown> {
  mockTool.mockClear();
  const server = createMockServer();
  registerArtifactTools(server, store);
  const call = mockTool.mock.calls.find((c: unknown[]) => c[0] === toolName);
  if (!call) {
    throw new Error(
      `Tool "${toolName}" not registered. Registered: ${mockTool.mock.calls.map((c: unknown[]) => c[0]).join(", ")}`,
    );
  }
  return call[2] as (...args: unknown[]) => Promise<unknown>;
}

function getToolSchema(store: ArtifactStore, toolName: string): z.ZodRawShape {
  mockTool.mockClear();
  const server = createMockServer();
  registerArtifactTools(server, store);
  const call = mockTool.mock.calls.find((c: unknown[]) => c[0] === toolName);
  if (!call) throw new Error(`Tool "${toolName}" not registered`);
  return call[1] as z.ZodRawShape;
}

function parseResult(result: unknown): Record<string, unknown> {
  const r = result as { content: { text: string }[] };
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
}

const TEST_SESSION_ID = "session-123";

// =============================================================================
// Tests
// =============================================================================

describe("MCP artifact authoring tools (adj-j7az6.2.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env["ADJUTANT_PUBLIC_URL"];
    delete process.env["PROPOSAL_PUBLIC_BASE_URL"];
    delete process.env["PORT"];
  });

  // ===========================================================================
  // Registration
  // ===========================================================================
  it("should register all four artifact tools", () => {
    const store = createMockStore();
    mockTool.mockClear();
    const server = createMockServer();
    registerArtifactTools(server, store);
    const names = mockTool.mock.calls.map((c: unknown[]) => c[0]);
    expect(names).toEqual(
      expect.arrayContaining(["create_artifact", "publish_artifact", "unpublish_artifact", "list_artifacts"]),
    );
  });

  // ===========================================================================
  // create_artifact
  // ===========================================================================
  describe("create_artifact", () => {
    it("should create an artifact and resolve the calling agent as created_by (server-side)", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("scribe");

      const handler = getToolHandler(store, "create_artifact");
      const result = await handler(
        { title: "My Page", html: "<h1>Hello</h1>", description: "a summary" },
        { sessionId: TEST_SESSION_ID },
      );

      expect(store.createArtifact).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "My Page",
          html: "<h1>Hello</h1>",
          description: "a summary",
          createdBy: "scribe",
        }),
      );
      const parsed = parseResult(result);
      expect(parsed).not.toHaveProperty("error");
      expect(parsed["id"]).toBe("art-uuid-1");
      expect(parsed["createdBy"]).toBe("scribe");
      expect(parsed["isPublic"]).toBe(false);
    });

    it("should NOT trust a client-supplied created_by — always resolve from the session", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("scribe");

      const handler = getToolHandler(store, "create_artifact");
      // A malicious/mistaken createdBy in the args must be ignored.
      await handler(
        { title: "T", html: "<p>x</p>", createdBy: "someone-else" },
        { sessionId: TEST_SESSION_ID },
      );

      expect(store.createArtifact).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: "scribe" }),
      );
      expect(store.createArtifact).not.toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: "someone-else" }),
      );
    });

    it("should auto-publish and return a public URL when public is true", async () => {
      const store = createMockStore();
      process.env["ADJUTANT_PUBLIC_URL"] = "https://share.example.com";
      mockGetAgentBySession.mockReturnValue("scribe");

      const handler = getToolHandler(store, "create_artifact");
      const result = await handler(
        { title: "T", html: "<p>x</p>", public: true },
        { sessionId: TEST_SESSION_ID },
      );

      expect(store.publishArtifact).toHaveBeenCalledWith("art-uuid-1");
      const parsed = parseResult(result);
      expect(parsed["isPublic"]).toBe(true);
      expect(parsed["shareToken"]).toBe("TOKENabc123456789");
      expect(parsed["publicUrl"]).toBe("https://share.example.com/a/TOKENabc123456789");
    });

    it("should NOT publish when public is omitted", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("scribe");

      const handler = getToolHandler(store, "create_artifact");
      const result = await handler(
        { title: "T", html: "<p>x</p>" },
        { sessionId: TEST_SESSION_ID },
      );

      expect(store.publishArtifact).not.toHaveBeenCalled();
      const parsed = parseResult(result);
      expect(parsed["publicUrl"]).toBeUndefined();
      expect(parsed["isPublic"]).toBe(false);
    });

    it("should return an error when the session is unknown (not connected via MCP)", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue(undefined);

      const handler = getToolHandler(store, "create_artifact");
      const result = await handler({ title: "T", html: "<p>x</p>" }, { sessionId: TEST_SESSION_ID });

      const parsed = parseResult(result);
      expect(parsed).toHaveProperty("error");
      expect(store.createArtifact).not.toHaveBeenCalled();
    });

    it("should reject missing title (Zod validation error)", () => {
      const store = createMockStore();
      const schema = z.object(getToolSchema(store, "create_artifact"));
      const result = schema.safeParse({ html: "<p>x</p>" });
      expect(result.success).toBe(false);
    });

    it("should reject missing html (Zod validation error)", () => {
      const store = createMockStore();
      const schema = z.object(getToolSchema(store, "create_artifact"));
      const result = schema.safeParse({ title: "T" });
      expect(result.success).toBe(false);
    });

    it("should reject empty title/html (min length)", () => {
      const store = createMockStore();
      const schema = z.object(getToolSchema(store, "create_artifact"));
      expect(schema.safeParse({ title: "", html: "<p>x</p>" }).success).toBe(false);
      expect(schema.safeParse({ title: "T", html: "" }).success).toBe(false);
    });

    it("should reject html that exceeds the size cap", () => {
      const store = createMockStore();
      const schema = z.object(getToolSchema(store, "create_artifact"));
      const oversized = "a".repeat(256 * 1024 + 1);
      expect(schema.safeParse({ title: "T", html: oversized }).success).toBe(false);
    });

    it("should accept a valid payload within the size cap", () => {
      const store = createMockStore();
      const schema = z.object(getToolSchema(store, "create_artifact"));
      const ok = "<p>" + "a".repeat(1000) + "</p>";
      expect(schema.safeParse({ title: "T", html: ok, description: "d", public: true }).success).toBe(true);
    });
  });

  // ===========================================================================
  // publish_artifact
  // ===========================================================================
  describe("publish_artifact", () => {
    it("should publish, toggle visibility, and return the public URL", async () => {
      const store = createMockStore();
      process.env["ADJUTANT_PUBLIC_URL"] = "https://share.example.com";
      mockGetAgentBySession.mockReturnValue("scribe");

      const handler = getToolHandler(store, "publish_artifact");
      const result = await handler({ id: "art-uuid-1" }, { sessionId: TEST_SESSION_ID });

      expect(store.publishArtifact).toHaveBeenCalledWith("art-uuid-1");
      const parsed = parseResult(result);
      expect(parsed).not.toHaveProperty("error");
      expect(parsed["isPublic"]).toBe(true);
      expect(parsed["shareToken"]).toBe("TOKENabc123456789");
      expect(parsed["publicUrl"]).toBe("https://share.example.com/a/TOKENabc123456789");
    });

    it("should fall back to a localhost origin when no public URL env is set", async () => {
      const store = createMockStore();
      process.env["PORT"] = "4201";
      mockGetAgentBySession.mockReturnValue("scribe");

      const handler = getToolHandler(store, "publish_artifact");
      const result = await handler({ id: "art-uuid-1" }, { sessionId: TEST_SESSION_ID });

      const parsed = parseResult(result);
      expect(parsed["publicUrl"]).toBe("http://localhost:4201/a/TOKENabc123456789");
    });

    it("should return a validation error for an unknown id", async () => {
      const store = createMockStore();
      (store.publishArtifact as ReturnType<typeof vi.fn>).mockReturnValue(null);
      mockGetAgentBySession.mockReturnValue("scribe");

      const handler = getToolHandler(store, "publish_artifact");
      const result = await handler({ id: "missing" }, { sessionId: TEST_SESSION_ID });

      const parsed = parseResult(result);
      expect(parsed).toHaveProperty("error");
    });

    it("should reject a missing id (Zod validation error)", () => {
      const store = createMockStore();
      const schema = z.object(getToolSchema(store, "publish_artifact"));
      expect(schema.safeParse({}).success).toBe(false);
    });
  });

  // ===========================================================================
  // unpublish_artifact
  // ===========================================================================
  describe("unpublish_artifact", () => {
    it("should revoke public access and confirm revocation", async () => {
      const store = createMockStore();
      mockGetAgentBySession.mockReturnValue("scribe");

      const handler = getToolHandler(store, "unpublish_artifact");
      const result = await handler({ id: "art-uuid-1" }, { sessionId: TEST_SESSION_ID });

      expect(store.unpublishArtifact).toHaveBeenCalledWith("art-uuid-1");
      const parsed = parseResult(result);
      expect(parsed).not.toHaveProperty("error");
      expect(parsed["isPublic"]).toBe(false);
      expect(parsed["revoked"]).toBe(true);
    });

    it("should return a validation error for an unknown id", async () => {
      const store = createMockStore();
      (store.unpublishArtifact as ReturnType<typeof vi.fn>).mockReturnValue(null);
      mockGetAgentBySession.mockReturnValue("scribe");

      const handler = getToolHandler(store, "unpublish_artifact");
      const result = await handler({ id: "missing" }, { sessionId: TEST_SESSION_ID });

      const parsed = parseResult(result);
      expect(parsed).toHaveProperty("error");
    });

    it("should reject a missing id (Zod validation error)", () => {
      const store = createMockStore();
      const schema = z.object(getToolSchema(store, "unpublish_artifact"));
      expect(schema.safeParse({}).success).toBe(false);
    });
  });

  // ===========================================================================
  // list_artifacts
  // ===========================================================================
  describe("list_artifacts", () => {
    it("should return the artifacts (newest-first previews) with a count", async () => {
      const store = createMockStore();
      (store.listArtifacts as ReturnType<typeof vi.fn>).mockReturnValue([
        { ...BASE_ARTIFACT, id: "a1", title: "One" },
        { ...BASE_ARTIFACT, id: "a2", title: "Two", isPublic: true, shareToken: "TOK" },
      ]);
      mockGetAgentBySession.mockReturnValue("scribe");

      const handler = getToolHandler(store, "list_artifacts");
      const result = await handler({}, { sessionId: TEST_SESSION_ID });

      expect(store.listArtifacts).toHaveBeenCalled();
      const parsed = parseResult(result) as { artifacts: Record<string, unknown>[]; count: number };
      expect(parsed.count).toBe(2);
      expect(parsed.artifacts).toHaveLength(2);
      expect(parsed.artifacts[0]!["id"]).toBe("a1");
      expect(parsed.artifacts[1]!["isPublic"]).toBe(true);
    });

    it("should return an empty list when there are no artifacts", async () => {
      const store = createMockStore();
      (store.listArtifacts as ReturnType<typeof vi.fn>).mockReturnValue([]);
      mockGetAgentBySession.mockReturnValue("scribe");

      const handler = getToolHandler(store, "list_artifacts");
      const result = await handler({}, { sessionId: TEST_SESSION_ID });

      const parsed = parseResult(result) as { artifacts: unknown[]; count: number };
      expect(parsed.count).toBe(0);
      expect(parsed.artifacts).toEqual([]);
    });
  });

  // ===========================================================================
  // Authoring contract surfaced in the tool schema
  // ===========================================================================
  describe("authoring contract", () => {
    it("should document the self-contained contract in the create_artifact html description", () => {
      const store = createMockStore();
      const schema = getToolSchema(store, "create_artifact");
      const htmlField = schema["html"] as z.ZodTypeAny;
      const description = htmlField.description ?? "";
      expect(description.toLowerCase()).toContain("self-contained");
      expect(description.toLowerCase()).toContain("no external");
      expect(description.toLowerCase()).toContain("no <script>");
    });
  });
});
