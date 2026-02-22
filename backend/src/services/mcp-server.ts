/**
 * MCP Server service for Adjutant.
 *
 * Provides the core MCP (Model Context Protocol) server that agents connect to
 * via SSE transport. Tracks connected agents and emits lifecycle events.
 *
 * Each SSE connection gets its own McpServer instance because the MCP SDK's
 * Protocol class only supports a single transport at a time. Tools are
 * registered on each new instance via the toolRegistrar callback.
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
  server: McpServer;
  transport: SSEServerTransport;
  connectedAt: Date;
}

/** Callback to register tools on a new McpServer instance. */
export type ToolRegistrar = (server: McpServer) => void;

// ============================================================================
// State
// ============================================================================

const connections = new Map<string, AgentConnection>();
let toolRegistrar: ToolRegistrar | null = null;

// ============================================================================
// Server lifecycle
// ============================================================================

/**
 * Create a new McpServer instance with tools registered.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "adjutant", version: "0.2.2" },
    {},
  );
  if (toolRegistrar) {
    toolRegistrar(server);
  }
  return server;
}

/**
 * Set the tool registrar callback. Called once at startup after
 * all tool registration functions are ready. Each new connection
 * will use this to register tools on its dedicated McpServer.
 */
export function setToolRegistrar(registrar: ToolRegistrar): void {
  toolRegistrar = registrar;
  logInfo("MCP tool registrar set");
}

/**
 * Reset state (for testing).
 */
export function resetMcpServer(): void {
  connections.clear();
  toolRegistrar = null;
}

/**
 * Initialize the MCP server subsystem. Called at startup.
 * Tool registration is done via setToolRegistrar() in index.ts.
 */
export function initMcpServer(): void {
  logInfo("MCP server initialized (per-connection model)");
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
 *
 * Creates a dedicated McpServer for this connection (the MCP SDK Protocol
 * only supports one transport per server instance). Tools are registered
 * via the toolRegistrar set at startup.
 *
 * NOTE: Do NOT call transport.start() before server.connect() — the SDK's
 * Protocol.connect() calls start() internally and SSEServerTransport throws
 * if started twice.
 */
export async function connectAgent(
  agentId: string,
  res: ServerResponse,
): Promise<AgentConnection> {
  const server = createMcpServer();
  const transport = new SSEServerTransport("/mcp/messages", res);

  // server.connect() calls transport.start() internally
  await server.connect(transport);

  const connection: AgentConnection = {
    agentId,
    sessionId: transport.sessionId,
    server,
    transport,
    connectedAt: new Date(),
  };

  connections.set(transport.sessionId, connection);

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

  // Close the per-connection server to release resources
  connection.server.close().catch(() => {});

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
