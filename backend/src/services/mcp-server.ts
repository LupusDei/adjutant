/**
 * MCP Server service for Adjutant.
 *
 * Provides the core MCP (Model Context Protocol) server that agents connect to
 * via SSE transport. Tracks connected agents and emits lifecycle events.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { logInfo, logWarn } from "../utils/index.js";
import { getEventBus } from "./event-bus.js";

// ============================================================================
// Types
// ============================================================================

export interface AgentConnection {
  agentId: string;
  sessionId: string;
  transport: SSEServerTransport;
  connectedAt: Date;
}

// ============================================================================
// State
// ============================================================================

let mcpServer: McpServer | null = null;
const connections = new Map<string, AgentConnection>();

// ============================================================================
// Server lifecycle
// ============================================================================

/**
 * Create a new McpServer instance.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "adjutant", version: "0.2.2" },
    {},
  );
  return server;
}

/**
 * Get the singleton McpServer, creating it if needed.
 */
export function getMcpServer(): McpServer {
  if (!mcpServer) {
    mcpServer = createMcpServer();
    logInfo("MCP server initialized");
  }
  return mcpServer;
}

/**
 * Reset the singleton (for testing).
 */
export function resetMcpServer(): void {
  connections.clear();
  mcpServer = null;
}

/**
 * Initialize the MCP server singleton. Called at startup.
 * Tool registration is done separately in index.ts.
 */
export function initMcpServer(): void {
  getMcpServer();
  logInfo("MCP server initialized");
}

// ============================================================================
// Agent identity resolution
// ============================================================================

/**
 * Resolve agent identity from request metadata.
 *
 * Priority: query param agentId > X-Agent-Id header > generated fallback.
 */
export function resolveAgentId(
  query: Record<string, unknown>,
  headers: Record<string, unknown>,
): string {
  const fromQuery = query["agentId"];
  if (typeof fromQuery === "string" && fromQuery.length > 0) {
    return fromQuery;
  }

  const fromHeader = headers["x-agent-id"];
  if (typeof fromHeader === "string" && fromHeader.length > 0) {
    return fromHeader;
  }

  return `unknown-agent-${randomUUID().slice(0, 8)}`;
}

// ============================================================================
// Connection tracking
// ============================================================================

/**
 * Connect an agent via SSE transport.
 */
export async function connectAgent(
  agentId: string,
  res: ServerResponse,
): Promise<AgentConnection> {
  const server = getMcpServer();
  const transport = new SSEServerTransport("/mcp/messages", res);

  await transport.start();
  await server.connect(transport);

  const connection: AgentConnection = {
    agentId,
    sessionId: transport.sessionId,
    transport,
    connectedAt: new Date(),
  };

  connections.set(transport.sessionId, connection);

  // Auto-disconnect when transport closes (network drop, agent crash, etc.)
  transport.onclose = () => {
    disconnectAgent(transport.sessionId);
  };

  logInfo("MCP agent connected", { agentId, sessionId: transport.sessionId });

  getEventBus().emit("mcp:agent_connected", {
    agentId,
    sessionId: transport.sessionId,
  });

  return connection;
}

/**
 * Disconnect an agent by session ID.
 */
export function disconnectAgent(sessionId: string): void {
  const connection = connections.get(sessionId);
  if (!connection) {
    logWarn("MCP disconnect for unknown session", { sessionId });
    return;
  }

  connections.delete(sessionId);

  logInfo("MCP agent disconnected", {
    agentId: connection.agentId,
    sessionId,
  });

  getEventBus().emit("mcp:agent_disconnected", {
    agentId: connection.agentId,
    sessionId,
  });
}

/**
 * Get all currently connected agents.
 */
export function getConnectedAgents(): AgentConnection[] {
  return Array.from(connections.values());
}

/**
 * Get the agent ID associated with an MCP session.
 * Used by MCP tool handlers to resolve who is calling the tool.
 */
export function getAgentBySession(sessionId: string): string | undefined {
  return connections.get(sessionId)?.agentId;
}

/**
 * Get a transport by session ID (for routing POST messages).
 */
export function getTransportBySession(
  sessionId: string,
): SSEServerTransport | undefined {
  return connections.get(sessionId)?.transport;
}
