import "dotenv/config";
import cors from "cors";
import express from "express";
import { agentsRouter, beadsRouter, convoysRouter, costsRouter, createMessagesRouter, devicesRouter, eventsRouter, mailRouter, mcpRouter, modeRouter, permissionsRouter, powerRouter, projectsRouter, sessionsRouter, statusRouter, swarmsRouter, tunnelRouter, voiceRouter } from "./routes/index.js";
import { apiKeyAuth } from "./middleware/index.js";
import { logInfo } from "./utils/index.js";
import { startCacheCleanupScheduler } from "./services/audio-cache.js";
import { startPrefixMapRefreshScheduler } from "./services/beads-service.js";
import { initWebSocketServer } from "./services/ws-server.js";
import { initAgentStatusStream } from "./services/agent-status-stream.js";
import { initTerminalStream } from "./services/terminal-stream.js";
import { initStreamingBridge } from "./services/streaming-bridge.js";
import { getSessionBridge } from "./services/session-bridge.js";
import { initMcpServer, setToolRegistrar } from "./services/mcp-server.js";
import { initDatabase } from "./services/database.js";
import { createMessageStore } from "./services/message-store.js";
import { registerMessagingTools } from "./services/mcp-tools/messaging.js";
import { registerStatusTools } from "./services/mcp-tools/status.js";
import { registerBeadTools } from "./services/mcp-tools/beads.js";
import { registerQueryTools } from "./services/mcp-tools/queries.js";
import { initMessageDelivery } from "./services/message-delivery.js";
import { initBeadAssignNotification } from "./services/bead-assign-notification.js";

const app = express();
const PORT = process.env["PORT"] ?? 4201;

// Middleware
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    logInfo("request completed", {
      method: req.method,
      path: req.originalUrl ?? req.url,
      status: res.statusCode,
      durationMs,
    });
  });
  next();
});
app.use(apiKeyAuth);

// Routes
app.use("/api/beads", beadsRouter);
app.use("/api/convoys", convoysRouter);
app.use("/api/agents", agentsRouter);
app.use("/api/devices", devicesRouter);
app.use("/api/events", eventsRouter);
app.use("/api/mail", mailRouter);
app.use("/api/mode", modeRouter);
app.use("/api/power", powerRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/status", statusRouter);
app.use("/api/tunnel", tunnelRouter);
app.use("/api/voice", voiceRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/swarms", swarmsRouter);
app.use("/api/permissions", permissionsRouter);
app.use("/api/costs", costsRouter);

// Initialize message store and mount messages router
const messageDb = initDatabase();
const messageStore = createMessageStore(messageDb);
app.use("/api/messages", createMessagesRouter(messageStore));

app.use("/mcp", mcpRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const server = app.listen(PORT, () => {
  logInfo("backend server listening", { port: PORT });

  // Start audio cache cleanup scheduler (T056)
  startCacheCleanupScheduler();

  // Start prefix map refresh scheduler (adj-sha0s)
  startPrefixMapRefreshScheduler();

  // Initialize WebSocket servers (all use noServer: true)
  const chatWss = initWebSocketServer(server, messageStore);
  const agentWss = initAgentStatusStream(server);
  const terminalWss = initTerminalStream(server);

  // Centralized WebSocket upgrade routing — prevents multi-WSS conflicts
  // where competing WSS instances call abortHandshake() on each other's sockets
  server.on("upgrade", (req, socket, head) => {
    const pathname = req.url?.split("?")[0];
    if (pathname === "/ws/chat") {
      chatWss.handleUpgrade(req, socket, head, (ws) => chatWss.emit("connection", ws, req));
    } else if (pathname === "/api/agents/stream") {
      agentWss.handleUpgrade(req, socket, head, (ws) => agentWss.emit("connection", ws, req));
    } else if (pathname === "/api/terminal/stream") {
      terminalWss.handleUpgrade(req, socket, head, (ws) => terminalWss.emit("connection", ws, req));
    } else {
      socket.destroy();
    }
  });

  // Initialize streaming bridge (watches .beads/streams/ for agent output)
  initStreamingBridge();

  // Initialize MCP server subsystem with tool registrar.
  // Each Streamable HTTP session gets its own McpServer; the registrar
  // is called on each new instance to wire up tools.
  initMcpServer();
  setToolRegistrar((server) => {
    registerMessagingTools(server, messageStore);
    registerStatusTools(server, messageStore);
    registerBeadTools(server);
    registerQueryTools(server, messageStore);
  });

  // Initialize message delivery (flushes pending messages when agents connect)
  initMessageDelivery(messageStore);

  // Initialize bead assignment notification (auto-messages agents on assignment)
  initBeadAssignNotification(messageStore);

  // Initialize Session Bridge v2 (tmux session management)
  // init() loads persisted sessions, verifies tmux state, and auto-creates
  // a Claude Code session if none are alive for the project root.
  getSessionBridge()
    .init()
    .catch((err) => {
      logInfo("session bridge init failed (non-fatal)", { error: String(err) });
    });
});
