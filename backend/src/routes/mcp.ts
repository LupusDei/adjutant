/**
 * MCP (Model Context Protocol) SSE routes.
 *
 * GET  /mcp/sse       - SSE endpoint for MCP agent connections
 * POST /mcp/messages   - Message endpoint for SSE transport
 */

import { Router } from "express";
import { connectAgent, disconnectAgent, resolveAgentId, getTransportBySession } from "../services/mcp-server.js";
import { logInfo, logError } from "../utils/index.js";

export const mcpRouter = Router();

/**
 * GET /sse - SSE endpoint for MCP connections.
 *
 * Agents connect here to establish an SSE stream. The MCP SDK uses this
 * stream to send messages to the client, while the client sends messages
 * back via POST /messages.
 */
mcpRouter.get("/sse", async (req, res) => {
  const agentId = resolveAgentId(
    req.query as Record<string, unknown>,
    req.headers as Record<string, unknown>,
  );

  try {
    const connection = await connectAgent(agentId, res);

    logInfo("MCP SSE connection established", {
      agentId,
      sessionId: connection.sessionId,
    });

    // Clean up on disconnect
    req.on("close", () => {
      disconnectAgent(connection.sessionId);
    });
  } catch (err) {
    logError("MCP SSE connection failed", {
      agentId,
      error: String(err),
    });
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to establish MCP connection" });
    }
  }
});

/**
 * POST /messages - Message endpoint for MCP SSE transport.
 *
 * The MCP SDK client sends JSON-RPC messages here. They are routed to
 * the correct SSEServerTransport by session ID.
 */
mcpRouter.post("/messages", async (req, res) => {
  const sessionId = req.query["sessionId"] as string | undefined;

  if (!sessionId) {
    res.status(400).json({ error: "Missing sessionId query parameter" });
    return;
  }

  const transport = getTransportBySession(sessionId);
  if (!transport) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  try {
    await transport.handlePostMessage(req, res);
  } catch (err) {
    logError("MCP message handling failed", {
      sessionId,
      error: String(err),
    });
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to handle MCP message" });
    }
  }
});
