/**
 * MCP Server service for Adjutant.
 *
 * Provides the core MCP (Model Context Protocol) server that agents connect to
 * via Streamable HTTP transport. Tracks connected agents and emits lifecycle events.
 *
 * Each session gets its own McpServer instance because the MCP SDK's
 * Protocol class only supports a single transport at a time. Tools are
 * registered on each new instance via the toolRegistrar callback.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { randomUUID } from "node:crypto";
import { logInfo, logWarn } from "../utils/index.js";
import { getEventBus } from "./event-bus.js";
import { clearAgentStatus } from "./mcp-tools/status.js";

// ============================================================================
// Types
// ============================================================================

export interface AgentConnection {
  agentId: string;
  sessionId: string;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
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
// Session transport factory
// ============================================================================

/**
 * Create a new StreamableHTTPServerTransport + McpServer pair for an agent.
 *
 * Returns the transport and server. The caller (route handler) should call
 * transport.handleRequest() with the initialization request.
 *
 * The session is tracked once the transport fires onsessioninitialized.
 */
export async function createSessionTransport(
  agentId: string,
  options?: { reuseSessionId?: string },
): Promise<{ transport: StreamableHTTPServerTransport; server: McpServer }> {
  const server = createMcpServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: options?.reuseSessionId
      ? () => options.reuseSessionId!
      : () => randomUUID(),
    onsessioninitialized: (sessionId: string) => {
      const connection: AgentConnection = {
        agentId,
        sessionId,
        server,
        transport,
        connectedAt: new Date(),
      };
      connections.set(sessionId, connection);

      logInfo("MCP agent connected", { agentId, sessionId });
      getEventBus().emit("mcp:agent_connected", { agentId, sessionId });
    },
    onsessionclosed: (sessionId: string) => {
      const connection = connections.get(sessionId);
      if (!connection) {
        return;
      }

      connections.delete(sessionId);
      connection.server.close().catch(() => {});
      clearAgentStatus(connection.agentId);

      logInfo("MCP agent disconnected", {
        agentId: connection.agentId,
        sessionId,
      });
      getEventBus().emit("mcp:agent_disconnected", {
        agentId: connection.agentId,
        sessionId,
      });
    },
  });

  // Clean up on transport close (e.g., network drop)
  transport.onclose = () => {
    if (transport.sessionId) {
      disconnectAgent(transport.sessionId);
    }
  };

  // Cast required: SDK's StreamableHTTPServerTransport declares onclose as
  // optional property, but exactOptionalPropertyTypes makes the types
  // incompatible with the Transport interface's optional onclose.
  await server.connect(transport as unknown as Transport);

  return { transport, server };
}

// ============================================================================
// Connection tracking
// ============================================================================

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

  // Clean up stale status data so disconnected agents
  // don't appear as working/blocked in /api/agents listings
  clearAgentStatus(connection.agentId);

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
 * Get a transport by session ID (for routing requests).
 */
export function getTransportBySession(
  sessionId: string,
): StreamableHTTPServerTransport | undefined {
  return connections.get(sessionId)?.transport;
}

// ============================================================================
// Session recovery
// ============================================================================

/**
 * Inner transport type — the Node.js StreamableHTTPServerTransport wraps
 * a WebStandardStreamableHTTPServerTransport which holds the actual
 * _initialized flag and sessionId. We need to set these directly because
 * the mock handshake approach fails: @hono/node-server's request converter
 * requires full Node.js HTTP objects (rawHeaders, host header, event
 * emitters, streams) that are impractical to mock correctly.
 */
interface WebStandardTransportInternals {
  _initialized: boolean;
  sessionId: string | undefined;
}

interface TransportWithInternals {
  _webStandardTransport: WebStandardTransportInternals;
}

/**
 * Recover a stale session by creating a new transport with the same session ID.
 *
 * When a client sends a request with a session ID that no longer exists
 * (e.g., after server restart), this creates a fresh transport+server pair,
 * directly initializes the transport's internal state, and registers the
 * connection so subsequent requests route normally.
 *
 * Returns the recovered transport, or undefined if recovery fails.
 */
export async function recoverSession(
  sessionId: string,
  agentId: string,
): Promise<StreamableHTTPServerTransport | undefined> {
  try {
    const { transport, server } = await createSessionTransport(agentId, {
      reuseSessionId: sessionId,
    });

    // Directly initialize the inner WebStandard transport.
    // The sessionIdGenerator was already configured to return the reused
    // sessionId, but it only fires during handlePostRequest which we skip.
    // Cast safe: StreamableHTTPServerTransport always wraps a
    // WebStandardStreamableHTTPServerTransport (see SDK source).
    const inner = (transport as unknown as TransportWithInternals)
      ._webStandardTransport;
    inner._initialized = true;
    inner.sessionId = sessionId;

    // Manually register the connection — the onsessioninitialized callback
    // set up in createSessionTransport won't fire without handleRequest.
    const connection: AgentConnection = {
      agentId,
      sessionId,
      server,
      transport,
      connectedAt: new Date(),
    };
    connections.set(sessionId, connection);

    logInfo("MCP session recovered", { agentId, sessionId });
    getEventBus().emit("mcp:agent_connected", { agentId, sessionId });

    return transport;
  } catch (err) {
    logWarn("MCP session recovery failed", {
      sessionId,
      agentId,
      error: String(err),
    });
    return undefined;
  }
}
