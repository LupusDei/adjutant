import "dotenv/config";
import cors from "cors";
import express from "express";
import { agentsRouter, beadsRouter, costsRouter, createCallsignsRouter, createDashboardRouter, createEventsRouter, createMessagesRouter, createOverviewRouter, createPersonasRouter, createProjectsRouter, createProposalsRouter, devicesRouter, mcpRouter, permissionsRouter, sessionsRouter, statusRouter, swarmsRouter, tunnelRouter, voiceRouter } from "./routes/index.js";
import { createDashboardService } from "./services/dashboard-service.js";
import { apiKeyAuth } from "./middleware/index.js";
import { logInfo } from "./utils/index.js";
import { startCacheCleanupScheduler } from "./services/audio-cache.js";
import { startPrefixMapRefreshScheduler } from "./services/beads/index.js";
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
import { registerProposalTools } from "./services/mcp-tools/proposals.js";
import { createProposalStore } from "./services/proposal-store.js";
import { createEventStore } from "./services/event-store.js";
import { createPersonaService, initPersonaService } from "./services/persona-service.js";
import { createCallsignToggleService } from "./services/callsign-toggle-service.js";
import { initMessageDelivery } from "./services/message-delivery.js";
import { initBeadAssignNotification } from "./services/bead-assign-notification.js";
import { discoverLocalProjects } from "./services/projects-service.js";
import { spawnAdjutant } from "./services/adjutant-spawner.js";
import { initAdjutantCore } from "./services/adjutant/adjutant-core.js";
import { BehaviorRegistry } from "./services/adjutant/behavior-registry.js";
import { createAdjutantState } from "./services/adjutant/state-store.js";
import { createCommunicationManager } from "./services/adjutant/communication.js";
import { agentLifecycleBehavior } from "./services/adjutant/behaviors/agent-lifecycle.js";
import { createHealthMonitorBehavior } from "./services/adjutant/behaviors/health-monitor.js";
import { createPeriodicSummaryBehavior } from "./services/adjutant/behaviors/periodic-summary.js";
import { createStaleAgentNudger } from "./services/adjutant/behaviors/stale-agent-nudger.js";
import { createWorkAssigner } from "./services/adjutant/behaviors/work-assigner.js";
import { createWorkRebalancer } from "./services/adjutant/behaviors/work-rebalancer.js";
import { createMemoryCollector } from "./services/adjutant/behaviors/memory-collector.js";
import { createSessionRetrospective } from "./services/adjutant/behaviors/session-retrospective.js";
import { createMemoryReviewer } from "./services/adjutant/behaviors/memory-reviewer.js";
import { createSelfImprover } from "./services/adjutant/behaviors/self-improver.js";
import { createAgentSpawnerBehavior } from "./services/adjutant/behaviors/agent-spawner.js";
import { createAgentDecommissioner } from "./services/adjutant/behaviors/agent-decommissioner.js";
import { createMemoryStore } from "./services/adjutant/memory-store.js";
import { registerMemoryTools } from "./services/mcp-tools/memory.js";
import { createMemoryRouter } from "./routes/memory.js";

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
app.use("/api/agents", agentsRouter);
app.use("/api/devices", devicesRouter);
// Events router mounted after eventStore creation below
app.use("/api/status", statusRouter);
app.use("/api/tunnel", tunnelRouter);
app.use("/api/voice", voiceRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/swarms", swarmsRouter);
app.use("/api/permissions", permissionsRouter);
app.use("/api/costs", costsRouter);

// Initialize message store and mount messages/projects routers
const messageDb = initDatabase();
const messageStore = createMessageStore(messageDb);
const proposalStore = createProposalStore(messageDb);
const eventStore = createEventStore(messageDb);
const memoryStore = createMemoryStore(messageDb);
app.use("/api/events", createEventsRouter(eventStore));
app.use("/api/memory", createMemoryRouter(memoryStore));
app.use("/api/messages", createMessagesRouter(messageStore));
app.use("/api/projects", createProjectsRouter(messageStore));
app.use("/api/overview", createOverviewRouter(messageStore));
app.use("/api/proposals", createProposalsRouter(proposalStore));

// Initialize persona and callsign toggle services and mount routes
const personaService = createPersonaService(messageDb);
initPersonaService(personaService);
const callsignToggleService = createCallsignToggleService(messageDb);
app.use("/api/personas", createPersonasRouter(personaService));
app.use("/api/callsigns", createCallsignsRouter(callsignToggleService));

// Prune events older than 7 days on startup, then every 6 hours
const PRUNE_DAYS = 7;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

const startupPruned = eventStore.pruneOldEvents(PRUNE_DAYS);
if (startupPruned > 0) {
  logInfo("Pruned old timeline events", { deletedCount: startupPruned, olderThanDays: PRUNE_DAYS });
}

setInterval(() => {
  const deletedCount = eventStore.pruneOldEvents(PRUNE_DAYS);
  if (deletedCount > 0) {
    logInfo("Pruned old timeline events", { deletedCount, olderThanDays: PRUNE_DAYS });
  }
}, PRUNE_INTERVAL_MS);

const dashboardService = createDashboardService(messageStore);
app.use("/api/dashboard", createDashboardRouter(dashboardService));

app.use("/mcp", mcpRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Eagerly register the CWD (or ADJUTANT_PROJECT_ROOT) as a project on startup.
// This ensures the current directory is always registered and active, even when
// projects.json already has entries from a previous session in a different directory.
discoverLocalProjects();
logInfo("CWD project auto-registered on startup");

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
    registerMessagingTools(server, messageStore, eventStore);
    registerStatusTools(server, messageStore, eventStore);
    registerBeadTools(server, eventStore);
    registerQueryTools(server, messageStore);
    registerProposalTools(server, proposalStore);
    registerMemoryTools(server, memoryStore);
  });

  // Initialize message delivery (flushes pending messages when agents connect)
  initMessageDelivery(messageStore);

  // Initialize bead assignment notification (auto-messages agents on assignment)
  initBeadAssignNotification(messageStore);

  // Initialize Session Bridge v2 (tmux session management)
  // init() loads persisted sessions, verifies tmux state, and auto-creates
  // a Claude Code session if none are alive for the project root.
  const projectRoot = process.env["ADJUTANT_PROJECT_ROOT"] || process.cwd();
  getSessionBridge()
    .init()
    .then(() => spawnAdjutant(projectRoot))
    .catch((err) => {
      logInfo("session bridge init failed (non-fatal)", { error: String(err) });
    });

  // Initialize Adjutant Core — event-driven behavior dispatch
  const adjutantState = createAdjutantState(messageDb);

  // On server restart, no agents are connected — mark all as disconnected
  // so work-assigner doesn't assign beads to dead agents.
  const staleMarked = adjutantState.markAllDisconnected();
  if (staleMarked > 0) {
    logInfo("Marked stale agent profiles as disconnected on startup", { count: staleMarked });
  }

  const adjutantComm = createCommunicationManager(messageStore);
  const behaviorRegistry = new BehaviorRegistry();

  behaviorRegistry.register(agentLifecycleBehavior);
  behaviorRegistry.register(createHealthMonitorBehavior(projectRoot));
  behaviorRegistry.register(createPeriodicSummaryBehavior());
  behaviorRegistry.register(createStaleAgentNudger());
  behaviorRegistry.register(createWorkAssigner());
  behaviorRegistry.register(createWorkRebalancer());
  behaviorRegistry.register(createMemoryCollector(memoryStore));
  behaviorRegistry.register(createSessionRetrospective(memoryStore));
  behaviorRegistry.register(createMemoryReviewer(memoryStore));
  behaviorRegistry.register(createSelfImprover(memoryStore, proposalStore));
  behaviorRegistry.register(createAgentSpawnerBehavior(projectRoot));
  behaviorRegistry.register(createAgentDecommissioner());

  initAdjutantCore({ registry: behaviorRegistry, state: adjutantState, comm: adjutantComm });
  logInfo("Adjutant Core initialized with event-driven behaviors");

  // Prune old decisions on startup, then every 6 hours (reuse PRUNE_INTERVAL_MS)
  const DECISION_PRUNE_DAYS = 30;
  const decisionsPruned = adjutantState.pruneOldDecisions(DECISION_PRUNE_DAYS);
  logInfo("Decision pruning", { deletedCount: decisionsPruned });

  setInterval(() => {
    const deletedCount = adjutantState.pruneOldDecisions(DECISION_PRUNE_DAYS);
    if (deletedCount > 0) {
      logInfo("Decision pruning", { deletedCount });
    }
  }, PRUNE_INTERVAL_MS);
});
