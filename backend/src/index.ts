import "dotenv/config";
import cors from "cors";
import express from "express";
import { agentsRouter, beadsRouter, costsRouter, createCallsignsRouter, createDashboardRouter, createEventsRouter, createMessagesRouter, createOverviewRouter, createPersonasRouter, createProjectsRouter, createProposalsRouter, createSchedulesRouter, devicesRouter, mcpRouter, permissionsRouter, sessionsRouter, statusRouter, swarmsRouter, tunnelRouter, voiceRouter } from "./routes/index.js";
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
import { initMcpServer, setToolRegistrar, getAgentBySession } from "./services/mcp-server.js";
import { initDatabase } from "./services/database.js";
import { createMessageStore } from "./services/message-store.js";
import { registerMessagingTools } from "./services/mcp-tools/messaging.js";
import { registerStatusTools } from "./services/mcp-tools/status.js";
import { registerBeadTools } from "./services/mcp-tools/beads.js";
import { registerQueryTools } from "./services/mcp-tools/queries.js";
import { registerProposalTools } from "./services/mcp-tools/proposals.js";
import { registerAutoDevelopTools } from "./services/mcp-tools/auto-develop.js";
import { createProposalStore, migrateProposalProjectNames } from "./services/proposal-store.js";
import { createEventStore } from "./services/event-store.js";
import { createPersonaService, initPersonaService } from "./services/persona-service.js";
import { createCallsignToggleService } from "./services/callsign-toggle-service.js";
import { initMessageDelivery } from "./services/message-delivery.js";
import { initBeadAssignNotification } from "./services/bead-assign-notification.js";
import { discoverLocalProjects, setAutoDevelopProductOwner, clearAutoDevelopProductOwner } from "./services/projects-service.js";
import { spawnAdjutant } from "./services/adjutant-spawner.js";
import { wireSpawnHealthChecks } from "./services/agent-spawner-service.js";
import { initCostTracker } from "./services/cost-tracker.js";
import { initEventDrivenCostExtraction } from "./services/event-driven-cost.js";
import { initAdjutantCore } from "./services/adjutant/adjutant-core.js";
import { BehaviorRegistry } from "./services/adjutant/behavior-registry.js";
import { createAdjutantState } from "./services/adjutant/state-store.js";
import { createCommunicationManager } from "./services/adjutant/communication.js";
import { agentLifecycleBehavior } from "./services/adjutant/behaviors/agent-lifecycle.js";
import { createHealthMonitorBehavior } from "./services/adjutant/behaviors/health-monitor.js";
import { createMemoryCollector } from "./services/adjutant/behaviors/memory-collector.js";
import { createSessionRetrospective } from "./services/adjutant/behaviors/session-retrospective.js";
import { createMemoryReviewer } from "./services/adjutant/behaviors/memory-reviewer.js";
import { createSelfImprover } from "./services/adjutant/behaviors/self-improver.js";
import { createIdleProposalNudge } from "./services/adjutant/behaviors/idle-proposal-nudge.js";
import { createAutoDevelopLoop } from "./services/adjutant/behaviors/auto-develop-loop.js";
import { createAutoDevelopStore } from "./services/auto-develop-store.js";
import { createMemoryStore } from "./services/adjutant/memory-store.js";
import { SignalAggregator } from "./services/adjutant/signal-aggregator.js";
import { StimulusEngine, buildSituationPrompt, buildBootstrapPrompt, type StateSnapshot } from "./services/adjutant/stimulus-engine.js";
import { getEventBus } from "./services/event-bus.js";

import { ADJUTANT_TMUX_SESSION } from "./services/adjutant-spawner.js";
import { registerMemoryTools } from "./services/mcp-tools/memory.js";
import { registerCoordinationTools } from "./services/mcp-tools/coordination.js";
import { createMemoryRouter } from "./routes/memory.js";
import { CronScheduleStore } from "./services/adjutant/cron-schedule-store.js";

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
migrateProposalProjectNames(messageDb);
const eventStore = createEventStore(messageDb);
const memoryStore = createMemoryStore(messageDb);
const cronScheduleStore = new CronScheduleStore(messageDb);
const autoDevelopStore = createAutoDevelopStore(messageDb);
app.use("/api/events", createEventsRouter(eventStore));
app.use("/api/memory", createMemoryRouter(memoryStore));
app.use("/api/messages", createMessagesRouter(messageStore));
app.use("/api/projects", createProjectsRouter(messageStore, proposalStore, autoDevelopStore));
app.use("/api/overview", createOverviewRouter(messageStore));
app.use("/api/proposals", createProposalsRouter(proposalStore));

// Initialize persona and callsign toggle services and mount routes
const personaService = createPersonaService(messageDb);
initPersonaService(personaService);
const callsignToggleService = createCallsignToggleService(messageDb);
app.use("/api/personas", createPersonasRouter(personaService));
app.use("/api/callsigns", createCallsignsRouter(callsignToggleService));

// Initialize cost tracker with SQLite database
initCostTracker(messageDb);

// Initialize event-driven cost extraction (subscribes to agent:status_changed)
initEventDrivenCostExtraction();

// Wire auto-develop events to timeline persistence + product owner assignment
{
  const bus = getEventBus();
  bus.on("project:auto_develop_enabled", (data) => {
    eventStore.insertEvent({
      eventType: "auto_develop_enabled",
      agentId: "system",
      action: `Auto-develop enabled for ${data.projectName}`,
      detail: { projectId: data.projectId, projectName: data.projectName, visionContext: data.visionContext ?? null },
    });

    // Auto-assign coordinator as product owner when auto-develop is enabled
    if (!data.resumeFromPause) {
      setAutoDevelopProductOwner(data.projectId, "adjutant-coordinator");
    }
  });
  bus.on("project:auto_develop_disabled", (data) => {
    eventStore.insertEvent({
      eventType: "auto_develop_disabled",
      agentId: "system",
      action: `Auto-develop disabled for ${data.projectName}`,
      detail: { projectId: data.projectId, projectName: data.projectName },
    });

    // Clear product owner when auto-develop is disabled
    clearAutoDevelopProductOwner(data.projectId);
  });
  bus.on("proposal:completed", (data) => {
    eventStore.insertEvent({
      eventType: "proposal_completed",
      agentId: "system",
      action: `Proposal completed${data.epicId ? ` (epic: ${data.epicId})` : ""}`,
      detail: { proposalId: data.proposalId, projectId: data.projectId, epicId: data.epicId ?? null },
    });
  });
  bus.on("auto_develop:phase_changed", (data) => {
    eventStore.insertEvent({
      eventType: "auto_develop_phase_changed",
      agentId: "system",
      action: `Phase: ${data.previousPhase} → ${data.newPhase}`,
      detail: { projectId: data.projectId, previousPhase: data.previousPhase, newPhase: data.newPhase, cycleId: data.cycleId },
    });
  });
}

// Proposal completion is coordinator-driven in VALIDATE phase (adj-153)
// The coordinator marks proposals complete after QA passes — no automated bead:closed listener

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
// the projects table already has entries from a previous session in a different directory.
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

  // Initialize Adjutant Core — event-driven behavior dispatch
  // NOTE: adjutantState and stimulusEngine must be created BEFORE
  // spawnAdjutant() so the tool registrar is ready when agents connect.
  // (adj-083 Bug 1: MCP tool registration race condition)
  const projectRoot = process.env["ADJUTANT_PROJECT_ROOT"] || process.cwd();
  const adjutantState = createAdjutantState(messageDb);

  // On server restart, no agents are connected — mark all as disconnected.
  const staleMarked = adjutantState.markAllDisconnected();
  if (staleMarked > 0) {
    logInfo("Marked stale agent profiles as disconnected on startup", { count: staleMarked });
  }

  const adjutantComm = createCommunicationManager(messageStore);
  const behaviorRegistry = new BehaviorRegistry();

  behaviorRegistry.register(agentLifecycleBehavior);
  behaviorRegistry.register(createHealthMonitorBehavior(projectRoot));
  behaviorRegistry.register(createMemoryCollector(memoryStore));
  behaviorRegistry.register(createSessionRetrospective(memoryStore));
  behaviorRegistry.register(createMemoryReviewer(memoryStore));
  behaviorRegistry.register(createSelfImprover(memoryStore, proposalStore));

  initAdjutantCore({ registry: behaviorRegistry, state: adjutantState, comm: adjutantComm });
  logInfo("Adjutant Core initialized with event-driven behaviors");

  // Signal Aggregator + Stimulus Engine — replaces periodic-summary
  const signalAggregator = new SignalAggregator();
  const stimulusEngine = new StimulusEngine();

  // Register stimulus-dependent behaviors (must come after stimulusEngine creation)
  behaviorRegistry.register(createIdleProposalNudge(stimulusEngine, proposalStore));
  behaviorRegistry.register(createAutoDevelopLoop(stimulusEngine, proposalStore, autoDevelopStore));

  // Mount schedules route (needs both cronScheduleStore and stimulusEngine)
  app.use("/api/schedules", createSchedulesRouter(cronScheduleStore, stimulusEngine));

  // Load recurring schedules from DB so they survive restarts
  stimulusEngine.loadRecurringSchedules(cronScheduleStore);
  logInfo("Recurring schedules loaded from DB");

  // Set tool registrar BEFORE MCP init and agent spawn so that any
  // connecting agent gets a fully-tooled MCP server.
  // (adj-083 Bug 1: fixes race where agent gets zero tools)
  setToolRegistrar((server) => {
    registerMessagingTools(server, messageStore, eventStore);
    registerStatusTools(server, messageStore, eventStore);
    registerBeadTools(server, eventStore, proposalStore, messageDb);
    registerQueryTools(server, messageStore);
    registerProposalTools(server, proposalStore);
    registerAutoDevelopTools(server, proposalStore, autoDevelopStore, { adjutantState, stimulusEngine });
    registerMemoryTools(server, memoryStore, { getAgentBySession });
    registerCoordinationTools(server, adjutantState, messageStore, stimulusEngine, eventStore, cronScheduleStore);
  });

  // Initialize MCP server subsystem with tool registrar.
  // Each Streamable HTTP session gets its own McpServer; the registrar
  // is called on each new instance to wire up tools.
  initMcpServer();

  // Wire spawn health checks — cancel pending timers when agents connect via MCP
  wireSpawnHealthChecks();

  // Initialize message delivery (flushes pending messages when agents connect)
  initMessageDelivery(messageStore, adjutantState);

  // Initialize bead assignment notification (auto-messages agents on assignment)
  initBeadAssignNotification(messageStore);

  // Initialize Session Bridge v2 (tmux session management)
  // init() loads persisted sessions, verifies tmux state, and auto-creates
  // a Claude Code session if none are alive for the project root.
  // spawnAdjutant is called AFTER setToolRegistrar to prevent race condition.
  getSessionBridge()
    .init()
    .then(() => spawnAdjutant(projectRoot))
    .catch((err) => {
      logInfo("session bridge init failed (non-fatal)", { error: String(err) });
    });

  // Wire critical signals from aggregator to stimulus engine
  signalAggregator.onCritical((signal) => {
    stimulusEngine.handleCriticalSignal(signal);
  });

  // Connect aggregator to EventBus
  // Skip coordinator:action to prevent feedback loop — the adjutant's own
  // actions should not re-enter the signal aggregator or trigger watches.
  getEventBus().onAny((event, data) => {
    if (event === "coordinator:action") return;
    signalAggregator.ingest(event, data);
    // Also trigger watches in the stimulus engine
    stimulusEngine.triggerWatch(event, data);
  });

  // Stimulus engine wake callback — inject prompt into adjutant tmux session
  stimulusEngine.onWake((reason) => {
    const bridge = getSessionBridge();
    const session = bridge.registry.findByTmuxSession(ADJUTANT_TMUX_SESSION);
    if (!session) {
      logInfo("StimulusEngine: wake skipped — no adjutant session", { reason: reason.type });
      return;
    }

    // Build state snapshot from adjutant state
    const profiles = adjutantState.getAllAgentProfiles();
    const stateSnapshot: StateSnapshot = {
      activeAgents: profiles.filter(p => p.disconnectedAt === null).length,
      workingAgents: profiles.filter(p => p.lastStatus === "working").length,
      blockedAgents: profiles.filter(p => p.lastStatus === "blocked").length,
      idleAgents: profiles.filter(p => p.lastStatus === "idle").length,
      inProgressBeads: 0, // Will be populated by the adjutant via list_beads
      readyBeads: 0,      // Will be populated by the adjutant via list_beads
    };

    const prompt = buildSituationPrompt({
      wakeReason: reason.reason ?? reason.type,
      signals: reason.signal ? [reason.signal] : [],
      contextSnapshot: signalAggregator.drain(),
      stateSnapshot,
      pendingSchedule: stimulusEngine.getPendingSchedule(),
      recentDecisions: adjutantState.getRecentDecisions(5),
    });

    bridge.sendInput(session.id, prompt).then((success) => {
      if (success) {
        adjutantState.logDecision({
          behavior: "stimulus-engine",
          action: `wake_${reason.type}`,
          target: reason.reason ?? null,
          reason: reason.signal ? `signal: ${reason.signal.event}` : null,
        });
      } else {
        logInfo("StimulusEngine: prompt injection failed", { reason: reason.type });
      }
    }).catch(() => {
      logInfo("StimulusEngine: prompt injection error", { reason: reason.type });
    });
  });

  // Bootstrap prompt — fires 60s after startup to orient the adjutant
  const BOOTSTRAP_DELAY_MS = 60_000;
  setTimeout(() => {
    const bridge = getSessionBridge();
    const session = bridge.registry.findByTmuxSession(ADJUTANT_TMUX_SESSION);
    if (!session) {
      logInfo("StimulusEngine: bootstrap skipped — no adjutant session");
      return;
    }
    const bootstrapPrompt = buildBootstrapPrompt();
    bridge.sendInput(session.id, bootstrapPrompt).then((success) => {
      if (success) {
        adjutantState.logDecision({
          behavior: "stimulus-engine",
          action: "bootstrap",
          target: ADJUTANT_TMUX_SESSION,
          reason: "Startup orientation prompt",
        });
        logInfo("StimulusEngine: bootstrap prompt sent");
      }
    }).catch(() => {
      logInfo("StimulusEngine: bootstrap prompt failed");
    });
  }, BOOTSTRAP_DELAY_MS);

  logInfo("StimulusEngine: connected to EventBus + SignalAggregator");

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
