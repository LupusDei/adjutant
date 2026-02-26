/**
 * MCP (Model Context Protocol) Streamable HTTP routes.
 *
 * POST /mcp   - Initialize new session or route tool calls to existing session
 * GET  /mcp   - SSE stream for server-initiated messages (by session ID)
 * DELETE /mcp - Session termination
 */

import { Router } from "express";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  createSessionTransport,
  resolveAgentId,
  resolveProjectContext,
  getTransportBySession,
  recoverSession,
} from "../services/mcp-server.js";
import { logInfo, logError } from "../utils/index.js";

export const mcpRouter = Router();

/**
 * POST / - Handle initialization or route to existing session.
 *
 * Without Mcp-Session-Id header: creates a new transport + server for the agent.
 * With Mcp-Session-Id header: routes to the existing transport.
 *
 * CRITICAL: Pass req.body as parsedBody since Express json() middleware
 * already consumed the request stream.
 */
mcpRouter.post("/", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId) {
    // Route to existing session, or recover if stale
    let transport = getTransportBySession(sessionId);

    if (!transport) {
      // Session not found — attempt transparent recovery
      const agentId = resolveAgentId(
        req.query as Record<string, unknown>,
        req.headers as Record<string, unknown>,
      );
      transport = await recoverSession(sessionId, agentId);

      if (!transport) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      logInfo("MCP session transparently recovered", { sessionId, agentId });
    }

    try {
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logError("MCP request handling failed", {
        sessionId,
        error: String(err),
      });
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to handle MCP request" });
      }
    }
    return;
  }

  // No session ID — must be an initialize request to create a new session.
  // Reject non-initialize requests to avoid creating orphaned transport+server.
  if (!isInitializeRequest(req.body)) {
    res.status(400).json({ error: "Missing Mcp-Session-Id header" });
    return;
  }

  const agentId = resolveAgentId(
    req.query as Record<string, unknown>,
    req.headers as Record<string, unknown>,
  );

  // Resolve project context from query params or headers (optional)
  const projectContext = resolveProjectContext(
    req.query as Record<string, unknown>,
    req.headers as Record<string, unknown>,
  );

  try {
    const { transport } = await createSessionTransport(agentId, {
      projectContext,
    });

    logInfo("MCP session transport created", {
      agentId,
      projectId: projectContext?.projectId,
    });

    // Let the transport handle the initialization request
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logError("MCP session creation failed", {
      agentId,
      error: String(err),
    });
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to create MCP session" });
    }
  }
});

/**
 * GET / - SSE stream for server-initiated messages.
 *
 * Requires Mcp-Session-Id header to identify the session.
 */
mcpRouter.get("/", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId) {
    res.status(400).json({ error: "Missing Mcp-Session-Id header" });
    return;
  }

  let transport = getTransportBySession(sessionId);
  if (!transport) {
    // Attempt transparent recovery for SSE reconnects
    const agentId = resolveAgentId(
      req.query as Record<string, unknown>,
      req.headers as Record<string, unknown>,
    );
    transport = await recoverSession(sessionId, agentId);

    if (!transport) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    logInfo("MCP SSE session transparently recovered", { sessionId, agentId });
  }

  try {
    await transport.handleRequest(req, res);
  } catch (err) {
    logError("MCP GET stream failed", {
      sessionId,
      error: String(err),
    });
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to open SSE stream" });
    }
  }
});

/**
 * DELETE / - Session termination.
 *
 * Requires Mcp-Session-Id header. The transport handles cleanup
 * via its onsessionclosed callback.
 */
mcpRouter.delete("/", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId) {
    res.status(400).json({ error: "Missing Mcp-Session-Id header" });
    return;
  }

  const transport = getTransportBySession(sessionId);
  if (!transport) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  try {
    await transport.handleRequest(req, res);
  } catch (err) {
    logError("MCP DELETE failed", {
      sessionId,
      error: String(err),
    });
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to terminate session" });
    }
  }
});
