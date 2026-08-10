/**
 * adj-j7az6.2.1 — MCP tools for agent authoring of global/personal Artifacts.
 *
 * Artifacts are self-contained, standalone HTML pages decoupled from proposals and beads —
 * a single fleet-wide library owned by the Commander with NO project scoping. These tools
 * let an agent author, publish, and list them:
 *   - create_artifact — write an artifact (caller resolved server-side as created_by);
 *     optionally publish immediately and return the public `/a/<token>` URL.
 *   - publish_artifact / unpublish_artifact — toggle the public share link by id.
 *   - list_artifacts — newest-first previews of the library.
 *
 * The authoring contract mirrors the adj-200 proposal tools (HTML_AUTHORING_CONTRACT): the
 * html must be SELF-CONTAINED (inline CSS + inline <svg>, `data:` images, NO external
 * resources, NO <script>/on*= handlers). The Phase-1 composition pipeline sanitizes every
 * body at render time, so anything outside this contract is removed.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getAgentBySession } from "../mcp-server.js";
import type { ArtifactStore } from "../artifact-store.js";
import { logInfo } from "../../utils/index.js";

/**
 * Maximum size (in characters) of an agent-authored self-contained `html` body. 256 KiB —
 * mirrors the adj-200 proposal cap. Enforced at the Zod boundary so an oversized document is
 * rejected before it reaches the store. Measured in UTF-16 code units (string length), a
 * close proxy for bytes for the predominantly-ASCII HTML agents produce.
 */
const MAX_HTML_CHARS = 256 * 1024;

/**
 * Agent-facing authoring contract for the self-contained artifact `html` body, surfaced
 * verbatim in the create_artifact tool schema so an authoring agent reads the rules at
 * tool-call time. Mirrors the proposal HTML_AUTHORING_CONTRACT (adj-200): the composition
 * pipeline sanitizes every body server-side, so anything outside this contract is removed.
 */
const HTML_AUTHORING_CONTRACT = [
  "REQUIRED self-contained HTML body for the artifact page (the public /a/<token> page,",
  "the in-app viewer, and iOS all render it). AUTHORING CONTRACT:",
  "(1) SELF-CONTAINED ONLY — style with an inline <style> block and inline CSS; draw graphics",
  "with inline <svg>. NO external resources of any kind: no external stylesheets, scripts, fonts,",
  "or images. Embed any image as a data: URI.",
  "(2) NO <script> and no on*= event handlers (onclick, onload, …) — both are stripped server-side.",
  "(3) Write a clean, readable DOCUMENT: semantic structure with headings (<h1>/<h2>), <section>s,",
  "paragraphs, lists, tables, and blockquotes.",
  "(4) DARK / ACCESSIBLE / FRIENDLY — author dark-by-default with a `@media (prefers-color-scheme:",
  "light)` variant; meet WCAG AA contrast (>=4.5:1 body text) against both backgrounds; keep visible",
  "focus styles; set lang on <html>.",
  `All html is sanitized server-side before rendering. Max ${MAX_HTML_CHARS} characters (256 KiB).`,
].join(" ");

/**
 * Build the public, no-API-key URL for a published artifact: `<origin>/a/<token>`.
 *
 * MCP tool handlers have no incoming HTTP request to derive the host from (unlike the REST
 * publish route, which uses `resolvePublicBaseUrl(req)`), so the origin is resolved from
 * configuration, in order:
 *   1. `PROPOSAL_PUBLIC_BASE_URL` — the same deployment-pinned external origin the REST
 *      `resolvePublicBaseUrl` prefers (shared so REST and MCP links match).
 *   2. `ADJUTANT_PUBLIC_URL` — canonical externally-reachable origin (e.g. a tunnel URL).
 *   3. Fallback: `http://localhost:<PORT>` (PORT mirrors the server's listen port, default 4201).
 * Any trailing slash on the configured origin is stripped so the result is never `//a/`.
 * Read at call-time (not module load) so deployment/test env changes take effect.
 */
export function buildPublicArtifactUrl(token: string): string {
  const port = process.env["PORT"] ?? "4201";
  const origin = (
    process.env["PROPOSAL_PUBLIC_BASE_URL"] ??
    process.env["ADJUTANT_PUBLIC_URL"] ??
    `http://localhost:${port}`
  ).replace(/\/+$/, "");
  return `${origin}/a/${token}`;
}

export function registerArtifactTools(server: McpServer, store: ArtifactStore): void {
  // ---------------------------------------------------------------------------
  // create_artifact
  // ---------------------------------------------------------------------------
  server.tool(
    "create_artifact",
    {
      title: z.string().min(1, "title is required").describe("Concise artifact title"),
      html: z
        .string()
        .min(1, "html is required")
        .max(MAX_HTML_CHARS, `html must be at most ${MAX_HTML_CHARS} characters (256 KiB)`)
        .describe(HTML_AUTHORING_CONTRACT),
      description: z.string().optional().describe("Optional short summary of the artifact"),
      public: z
        .boolean()
        .optional()
        .describe(
          "When true, immediately publish the artifact and return a no-API-key public URL " +
            "(publicUrl) anyone can open at /a/<token> — no API key required. Defaults to private.",
        ),
    },
    async ({ title, html, description, public: makePublic }, extra) => {
      // Server-side identity: the caller is resolved from the MCP session, never client-supplied.
      const agentId = extra.sessionId ? getAgentBySession(extra.sessionId) : undefined;
      if (!agentId) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Unknown session — not connected via MCP" }) }],
        };
      }

      let current = store.createArtifact({
        title,
        html,
        description,
        createdBy: agentId,
      });

      // Optional auto-publish: flip visibility (generating the share token if absent) and
      // return the public URL so the agent can hand off a working link immediately.
      let publicUrl: string | undefined;
      if (makePublic) {
        const published = store.publishArtifact(current.id);
        if (published) {
          current = published;
          if (published.shareToken) publicUrl = buildPublicArtifactUrl(published.shareToken);
        }
      }

      logInfo("create_artifact", { agentId, artifactId: current.id, title, public: makePublic === true });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            id: current.id,
            title: current.title,
            description: current.description,
            createdBy: current.createdBy,
            isPublic: current.isPublic,
            createdAt: current.createdAt,
            ...(current.shareToken ? { shareToken: current.shareToken } : {}),
            ...(publicUrl ? { publicUrl } : {}),
          }),
        }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // publish_artifact
  // ---------------------------------------------------------------------------
  server.tool(
    "publish_artifact",
    {
      id: z
        .string()
        .min(1)
        .describe(
          "Artifact id to publish. Returns a no-API-key public URL (publicUrl) that serves " +
            "the artifact's sanitized, self-contained HTML page at /a/<token>.",
        ),
    },
    async ({ id }) => {
      const published = store.publishArtifact(id);
      if (!published) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Artifact not found" }) }],
        };
      }

      const publicUrl = published.shareToken ? buildPublicArtifactUrl(published.shareToken) : undefined;
      logInfo("publish_artifact", { artifactId: id, shareToken: published.shareToken });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            id: published.id,
            isPublic: published.isPublic,
            shareToken: published.shareToken,
            publishedAt: published.publishedAt,
            ...(publicUrl ? { publicUrl } : {}),
          }),
        }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // unpublish_artifact
  // ---------------------------------------------------------------------------
  server.tool(
    "unpublish_artifact",
    {
      id: z.string().min(1).describe("Artifact id to unpublish (revoke the public share link)"),
    },
    async ({ id }) => {
      const unpublished = store.unpublishArtifact(id);
      if (!unpublished) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Artifact not found" }) }],
        };
      }

      logInfo("unpublish_artifact", { artifactId: id });

      // The share token is retained so a later re-publish revives the same link, but the
      // public route now 404s. Confirm the revocation explicitly.
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            id: unpublished.id,
            isPublic: unpublished.isPublic,
            revoked: true,
          }),
        }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // list_artifacts
  // ---------------------------------------------------------------------------
  server.tool(
    "list_artifacts",
    {},
    async () => {
      const artifacts = store.listArtifacts();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            artifacts: artifacts.map((a) => ({
              id: a.id,
              title: a.title,
              descriptionPreview:
                a.description && a.description.length > 100
                  ? a.description.slice(0, 100) + "…"
                  : a.description,
              createdBy: a.createdBy,
              isPublic: a.isPublic,
              ...(a.shareToken ? { shareToken: a.shareToken } : {}),
              createdAt: a.createdAt,
              updatedAt: a.updatedAt,
            })),
            count: artifacts.length,
          }),
        }],
      };
    },
  );
}
