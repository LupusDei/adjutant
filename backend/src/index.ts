import "dotenv/config";
import cors from "cors";
import express from "express";
import { agentsRouter, beadsRouter, costsRouter, createAvatarRouter, createCallsignsRouter, createDashboardRouter, createEventsRouter, createMessagesRouter, createOverviewRouter, createPersonasRouter, createProjectsRouter, createProposalsRouter, createPublicProposalsRouter, createQuestionsRouter, createSchedulesRouter, createWebhooksRouter, devicesRouter, mcpRouter, permissionsRouter, sessionsRouter, statusRouter, swarmsRouter, tunnelRouter, voiceRouter } from "./routes/index.js";
import { createDashboardService } from "./services/dashboard-service.js";
import { apiKeyAuth } from "./middleware/index.js";
import { logInfo, logWarn } from "./utils/index.js";
import { startCacheCleanupScheduler } from "./services/audio-cache.js";
import { startPrefixMapRefreshScheduler } from "./services/beads/index.js";
import { startUploadRetentionScheduler } from "./services/upload-retention.js";
import { initWebSocketServer, setConversationStore, wsBroadcast } from "./services/ws-server.js";
import { initAgentStatusStream } from "./services/agent-status-stream.js";
import { initTerminalStream } from "./services/terminal-stream.js";
import { initStreamingBridge } from "./services/streaming-bridge.js";
import { getSessionBridge } from "./services/session-bridge.js";
import { initMcpServer, setToolRegistrar, getAgentBySession, startMcpSessionReaper } from "./services/mcp-server.js";
import { initDatabase } from "./services/database.js";
import { createMessageStore } from "./services/message-store.js";
import { createAttachmentStore } from "./services/attachment-store.js";
import { createUploadStorage } from "./services/upload-storage.js";
import { createUploadService } from "./services/upload-service.js";
import { createUploadsRouter } from "./routes/uploads.js";
import { registerMessagingTools } from "./services/mcp-tools/messaging.js";
import { registerChannelTools } from "./services/mcp-tools/channels.js";
import { registerStatusTools } from "./services/mcp-tools/status.js";
import { registerBeadTools } from "./services/mcp-tools/beads.js";
import { registerQueryTools } from "./services/mcp-tools/queries.js";
import { registerProposalTools } from "./services/mcp-tools/proposals.js";
import { registerQuestionTools } from "./services/mcp-tools/questions.js";
import { registerAutoDevelopTools } from "./services/mcp-tools/auto-develop.js";
import { createProposalStore, migrateProposalProjectNames } from "./services/proposal-store.js";
import { backfillConversations } from "./services/conversation-backfill.js";
import { createConversationStore } from "./services/conversation-store.js";
import { createConversationsRouter } from "./routes/conversations.js";
import { createChannelsRouter } from "./routes/channels.js";
import { createBridgeRouter } from "./routes/bridge.js";
import { BridgeSessionBroker } from "./services/bridge-session-broker.js";
import { createBridgeToolBridge } from "./services/bridge-tool-bridge.js";
import { createBridgeRpcManager } from "./services/bridge-rpc-handler.js";
import { createBridgeSessionCollector } from "./services/bridge-session-collector.js";
import { createBridgeTranscriptPersister } from "./services/bridge-transcript-persister.js";
import { createBridgeTranscriptFetch } from "./services/bridge-transcript-fetch.js";
import { buildBridgePersonaEvolution } from "./services/bridge-operating-lessons.js";
import { BRIDGE_DIRECTIVE_PREFIX } from "./services/bridge-rpc-tools.js";
import { deliverDirectMessage } from "./services/direct-message-delivery.js";
import { nudgeAgentViaBridge, answerQuestionViaBridge, createBeadViaBridge, spawnWorkerViaBridge, storeMemoryViaBridge, reinforceMemoryViaBridge, recordCorrectionViaBridge } from "./services/bridge-commands.js";
import { getAgents } from "./services/agents-service.js";
import { resolveAgentName } from "./services/bridge-agent-resolver.js";
import { createEventStore } from "./services/event-store.js";
import { createQuestionStore } from "./services/question-store.js";
import { createQuestionService } from "./services/question-service.js";
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
import { createSoftStallDetector } from "./services/adjutant/behaviors/soft-stall-detector.js";
import { execFile as execFileForStallDetector } from "child_process";
import { createAutoDevelopStore } from "./services/auto-develop-store.js";
import { createMemoryStore } from "./services/adjutant/memory-store.js";
import { SignalAggregator } from "./services/adjutant/signal-aggregator.js";
import { StimulusEngine, buildSituationPrompt, buildBootstrapPrompt, type StateSnapshot, type DeltaItem } from "./services/adjutant/stimulus-engine.js";
import { handleWakeRouting } from "./services/adjutant/wake-routing.js";
import { getEventBus } from "./services/event-bus.js";

import { ADJUTANT_TMUX_SESSION } from "./services/adjutant-spawner.js";
import { registerMemoryTools } from "./services/mcp-tools/memory.js";
import { registerCoordinationTools } from "./services/mcp-tools/coordination.js";
import { registerPersonaTools } from "./services/mcp-tools/personas.js";
import { createMemoryRouter } from "./routes/memory.js";
import { CronScheduleStore } from "./services/adjutant/cron-schedule-store.js";
import { startDoltSupervisorFromEnv } from "./services/dolt-supervisor.js";

const app = express();
const PORT = process.env["PORT"] ?? 4201;

// Adjutant is served through a reverse proxy / tunnel (ngrok, tunnelRouter), so trust
// the proxy's X-Forwarded-* headers. This makes req.protocol / req.hostname / req.ip
// reflect the EXTERNAL origin — required so public proposal share links (`/p/:token`)
// are built against the tunnel host rather than http://localhost (adj-200.2.6.1).
app.set("trust proxy", true);

// Stores must be initialized BEFORE the webhook router below — webhook routes
// are mounted ahead of the global JSON body parser so HMAC verification can
// read raw bytes, and they need eventStore for persisting deploy events.
const messageDb = initDatabase();
// adj-203: attachment store shares the message DB; injected into the message store so
// message reads hydrate `attachments` and sends link uploaded images to the message.
const attachmentStore = createAttachmentStore(messageDb);
const messageStore = createMessageStore(messageDb, { attachmentStore });
// adj-203: image upload pipeline — storage primitive (ADJUTANT_UPLOAD_DIR) + service.
const uploadStorage = createUploadStorage();
uploadStorage.ensureDir();
const uploadService = createUploadService({ storage: uploadStorage, attachmentStore });
const proposalStore = createProposalStore(messageDb);
const conversationStore = createConversationStore(messageDb, messageStore);
migrateProposalProjectNames(messageDb);
// adj-164.1.4 — backfill legacy messages into DM conversations. Idempotent:
// messages already carrying a conversation_id are skipped, so this is a no-op
// on every startup after the first.
backfillConversations(messageDb);
const eventStore = createEventStore(messageDb);
const memoryStore = createMemoryStore(messageDb);
const cronScheduleStore = new CronScheduleStore(messageDb);
const autoDevelopStore = createAutoDevelopStore(messageDb);

// Middleware
app.use(cors());

// External webhook receivers authenticate via cryptographic signature over
// the raw body, NOT the dashboard API key. They MUST be mounted before
// express.json() so signature verification sees the exact bytes Vercel signed.
app.use("/api/webhooks", createWebhooksRouter(eventStore));

// adj-ovbhc: raise the JSON body limit well above the largest legitimate MCP
// payload. Express's 100 KB default would 413-reject (or stall) a revise_proposal
// carrying a near-max html body — the tool advertises up to 256 KiB of html, plus
// title/description/changelog and JSON-escaping overhead. 1 MB covers that with
// headroom so large-but-valid authoring payloads round-trip intact.
app.use(express.json({ limit: "1mb" }));
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

// Public, unauthenticated proposal pages (adj-200). MUST be mounted BEFORE apiKeyAuth
// so a shareable /p/:token link works in any browser with no API key.
app.use("/p", createPublicProposalsRouter(proposalStore));

// adj-181.3 / adj-181.2 — question triage service. Constructed here (BEFORE the /avatar
// mount) because the read-only Bridge tool bridge depends on it, and the iOS/default
// /avatar route now shares that broker + tool loop (adj-202.7.1). Still top-level so the
// MCP setToolRegistrar callback can reach it. Its REST route is mounted below, after auth.
const questionStore = createQuestionStore(messageDb);
const questionService = createQuestionService({
  questionStore,
  conversationStore,
  messageStore,
  wsBroadcast,
  // adj-181.19: inject the answer into the asking agent's live tmux session so it
  // acts immediately instead of waiting to read its DM. Mirrors the proven
  // bead-assign-notification pattern; no-ops gracefully when no live session.
  notifyAgentSession: (agentId, text) => {
    try {
      const bridge = getSessionBridge();
      for (const session of bridge.registry.findByName(agentId)) {
        if (session.status === "offline") continue;
        void bridge.sendInput(session.id, text).catch(() => {});
      }
    } catch {
      // Session bridge not ready — agent will pull the answer from its DM.
    }
  },
});

// adj-202.3.5 / adj-202.7 — The Bridge: cost-guarded avatar session broker + read-only
// fleet tool surface + the server-side tool loop. Constructed BEFORE /avatar so the
// iOS/default route can share the SAME broker + tool loop (adj-202.7.1). startSession()
// spends real Runway credits, so the /api/bridge REST surface stays behind apiKeyAuth.
const bridgeBroker = new BridgeSessionBroker();
const bridgeToolBridge = createBridgeToolBridge({
  messageStore,
  proposalStore,
  autoDevelopStore,
  questionService,
  // adj-202.6.1 — the avatar RECALLS prior learnings/preferences/corrections via the
  // SAME memory store the MCP query_memories tool and the rest of the system read.
  memoryStore,
});
// Dispatches the avatar's `backend_rpc` calls to the SAME read-only tool bridge, so a
// spoken status question resolves to real fleet data instead of stalling on "querying…".
// adj-202.4.1: the avatar can also DIRECT agents — send_message is a deliberate write
// path (the read-only bridge stays fail-closed) that reuses deliverDirectMessage, the
// same persist+broadcast+inject path the user→agent route uses. Sent as the "adjutant"
// coordinator and prefixed so the agent knows it's a command directive via The Bridge.
// adj-202.4.6: resolve a spoken agent NAME to a registered agent's canonical messaging
// name before any command tool delivers (the avatar said "Phoenix" for "fenix" and the
// message vanished to a phantom recipient). No confident match throws — the dispatch
// surfaces the message so the avatar asks the Commander instead of sending into the void.
async function resolveBridgeAgent(spoken: string): Promise<string> {
  const res = await getAgents();
  const agents = res.success && res.data ? res.data.map((a) => ({ id: a.id, name: a.name })) : [];
  const resolution = resolveAgentName(spoken, agents);
  if (!resolution.matched || !resolution.canonical) {
    const hint = resolution.candidates.length ? ` Did you mean: ${resolution.candidates.join(", ")}?` : "";
    throw new Error(`No agent named "${spoken}".${hint}`);
  }
  return resolution.canonical;
}

// adj-202.6.2 — the per-session activity collector that turns Bridge conversations into
// implicit learnings in the adjutant MemoryStore (the same store query_memories/store_memory use).
const bridgeSessionCollector = createBridgeSessionCollector({ memoryStore });

// adj-202.6.6 — make the Bridge a PERSISTENT CHAT with default history: on session end the
// session's transcript is fetched from Runway's conversations REST API and each turn (the
// Commander's speech + the avatar's responses) is persisted into the SAME user↔adjutant DM the
// Commander already has, via the REAL conversation + message stores (Rules 4 + 9 — no new store).
// wsBroadcast fans each turn out live so the dashboard/iOS Chat update once the transcript lands.
// (Runway GWM-1 publishes no lk.transcription streams — verified live — so the REST fetch is the
// proven path; the transport-layer listener has been retired.)
// The Bridge avatar IS the adjutant coordinator (Phase 4 — one identity): turns persist AS
// "adjutant-coordinator" (the avatar) and "user" (the Commander) into the Commander's existing
// coordinator chat — never a separate, invisible "adjutant" thread.
const BRIDGE_COORDINATOR_ID = "adjutant-coordinator";

const bridgeTranscriptPersister = createBridgeTranscriptPersister({
  conversationStore,
  messageStore,
  coordinatorId: BRIDGE_COORDINATOR_ID,
  broadcast: ({ message, from, to }) => {
    wsBroadcast({
      type: "chat_message",
      id: message.id,
      from,
      to,
      body: message.body,
      timestamp: message.createdAt,
      conversationId: message.conversationId ?? undefined,
      metadata: message.metadata ?? undefined,
    });
  },
});
// The fetch service reuses the broker's Runway creds (RUNWAYML_API_SECRET + RUNWAY_AVATAR_ID)
// and the persister above; fired once per session end (idempotent, best-effort).
const bridgeTranscriptFetch = createBridgeTranscriptFetch({ persister: bridgeTranscriptPersister });

const bridgeRpcManager = createBridgeRpcManager({
  executeTool: (req) => bridgeToolBridge.executeTool(req),
  sendMessage: async ({ to, body }) => {
    const canonical = await resolveBridgeAgent(to);
    const result = deliverDirectMessage(
      { store: messageStore, eventStore },
      {
        from: BRIDGE_COORDINATOR_ID,
        to: canonical,
        body,
        role: "agent",
        emitEvent: true,
        deliveryText: `${BRIDGE_DIRECTIVE_PREFIX}${body}`,
      },
    );
    return {
      messageId: result.messageId,
      conversationId: result.conversationId,
      deliveredToSessions: result.deliveredToSessions,
    };
  },
  // adj-202.4.2/.3/.4 — more safe-write command tools, each reusing the REAL service
  // (Rules 4+9): nudge → session bridge, answer_question → question-service, create_bead
  // → bd CLI. Reversible → no confirm gate; attributed to the coordinator; logged.
  nudgeAgent: async (input) =>
    nudgeAgentViaBridge({ agentId: await resolveBridgeAgent(input.agentId), message: input.message }),
  answerQuestion: (input) => answerQuestionViaBridge(questionService, input),
  createBead: (input) => createBeadViaBridge(input),
  // adj-202.4.5 — spawn_worker: HEAVY, so it reuses the REAL spawn service (Rules 4+9)
  // behind a read-back/confirm gate (no spawn unless confirm:true). decommission/destroy
  // intentionally stay OUT of the avatar's toolset.
  spawnWorker: (input) => spawnWorkerViaBridge(input),
  // adj-202.6.1 — the avatar LEARNS from the Commander: persist stated preferences/decisions,
  // reinforce reaffirmed memories, and capture corrections — all through the SAME adjutant
  // MemoryStore the MCP tools use (Rules 4+9). Reversible → no confirm gate; logged.
  storeMemory: async (input) => storeMemoryViaBridge(memoryStore, input),
  reinforceMemory: async (input) => reinforceMemoryViaBridge(memoryStore, input),
  recordCorrection: async (input) => recordCorrectionViaBridge(memoryStore, input),
  // adj-202.6.2 — AUTO-LEARN: observe every tool call per session and, on session end, distill
  // the session's dominant usage pattern into the SAME memory store the self-improvement loop
  // reads. So the coordinator improves from Bridge conversations even when the avatar was never
  // told to store_memory. Best-effort; finalize never throws (must not break session teardown).
  recordActivity: (sessionId, tool, ok) => { bridgeSessionCollector.record(sessionId, { tool, ok }); },
  finalizeSession: (sessionId) => { bridgeSessionCollector.finalize(sessionId); },
  // adj-202.6.6 — on session end, fetch the transcript from Runway + persist it into the
  // coordinator conversation (default history). Best-effort + idempotent; never throws.
  onSessionEnd: (sessionId) => { void bridgeTranscriptFetch.fetchAndPersist(sessionId); },
});

// The Bridge — avatar (adj-202.2 / adj-202.7.1). Public (no API key) so the iOS WKWebView
// overlay can load /avatar and call /avatar/connect same-origin. Mounted BEFORE apiKeyAuth.
// It shares the broker + tool loop so the phone avatar is cost-guarded AND can query the fleet.
app.use(
  "/avatar",
  createAvatarRouter({
    broker: bridgeBroker,
    rpcManager: bridgeRpcManager,
    // adj-202.10.1: re-validate a cached warm session is still READY before handing it out,
    // so a session Runway has since FAILED never reaches the client (no manual second tap).
    getSessionStatus: (sessionId) => bridgeBroker.getSessionStatus(sessionId),
    // adj-207.4.5: vend a room-scoped LiveKit token so the native iOS LiveKit client (Phase B)
    // subscribes to the SAME avatar room for system PiP — no second Runway session, no double burn.
    getNativeConsumerCreds: (sessionId) => bridgeBroker.getNativeConsumerCreds(sessionId),
    // adj-202: the iOS/default avatar selects no project, so default its project-scoped tools
    // (get_project_state, list_beads, get_auto_develop_status) to "adjutant" — otherwise they
    // error PROJECT_REQUIRED. getProject resolves the name; the dashboard still passes its own.
    defaultProjectId: "adjutant",
    // adj-202.6.4 — open each iOS/default session already knowing the Commander (memory seed).
    // adj-202.6.3 — and carrying the EVOLVED operating lessons distilled from recent retros, so
    // the avatar's guidance grows over time (recall seed + lessons, both bounded).
    buildMemorySeed: () => buildBridgePersonaEvolution({ memoryStore }),
  }),
);

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

// Stores were initialized above (before the webhook router); mount their routes here.
app.use("/api/events", createEventsRouter(eventStore));
app.use("/api/memory", createMemoryRouter(memoryStore));
app.use("/api/messages", createMessagesRouter(messageStore));
// adj-203: image upload + serve API. Behind apiKeyAuth (mounted above) — GET /:id
// streams stored screenshots to the authenticated operator; POST accepts multipart.
app.use("/api/uploads", createUploadsRouter(uploadService));
app.use("/api/conversations", createConversationsRouter(conversationStore, messageStore));
app.use("/api/channels", createChannelsRouter(conversationStore));
app.use("/api/projects", createProjectsRouter(messageStore, proposalStore, autoDevelopStore));
app.use("/api/overview", createOverviewRouter(messageStore));
app.use("/api/proposals", createProposalsRouter(proposalStore));

// adj-181.3 — agent question triage REST API (service constructed above the /avatar mount).
app.use("/api/questions", createQuestionsRouter(questionService));

// adj-202.3.5 / adj-202.7 — The Bridge REST surface (broker + tool bridge + tool loop all
// constructed above). Behind apiKeyAuth (the dashboard calls it with the key): startSession()
// spends real Runway credits, so it must not be public.
app.use(
  "/api/bridge",
  createBridgeRouter({
    broker: bridgeBroker,
    toolBridge: bridgeToolBridge,
    rpcManager: bridgeRpcManager,
    // adj-202.6.4 — seed the dashboard avatar's persona with recalled memory too.
    // adj-202.6.3 — plus the evolved operating lessons from recent retros (bounded).
    buildMemorySeed: () => buildBridgePersonaEvolution({ memoryStore }),
  }),
);

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
  bus.on("persona:created", (data) => {
    eventStore.insertEvent({
      eventType: "persona_created",
      agentId: data.callsign,
      action: `Persona "${data.personaName}" created via ${data.source}`,
      detail: { personaId: data.personaId, personaName: data.personaName, callsign: data.callsign, source: data.source },
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

// adj-182.2.5 — Dolt supervisor self-heal loop. GATED behind a default-OFF env
// flag (ADJUTANT_DOLT_SUPERVISOR): when unset/0 (the default) this is a NO-OP and
// does NOT adopt the supervisor or perform any cutover on the running backend. The
// real cutover is a separate operator step that flips the flag (karax + General).
void startDoltSupervisorFromEnv()
  .then((handle) => {
    if (handle.enabled) {
      logInfo("Dolt supervisor self-heal loop active");
    }
  })
  .catch((err) => {
    logWarn("Dolt supervisor start failed (non-fatal)", { error: String(err) });
  });

const server = app.listen(PORT, () => {
  logInfo("backend server listening", { port: PORT });

  // Start audio cache cleanup scheduler (T056)
  startCacheCleanupScheduler();

  // Start prefix map refresh scheduler (adj-sha0s)
  startPrefixMapRefreshScheduler();

  // adj-203.6.1 — periodic upload retention sweep: prune stored screenshots + their
  // attachment rows older than ADJUTANT_UPLOAD_TTL_DAYS (default 7). Logs the count.
  startUploadRetentionScheduler({ attachmentStore, storage: uploadStorage });

  // Initialize WebSocket servers (all use noServer: true)
  const chatWss = initWebSocketServer(server, messageStore);
  // Wire the conversation store so room-scoped channel fan-out can resolve
  // membership (adj-164.4.3).
  setConversationStore(conversationStore);
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
  // adj-y2vq PART B: detect + auto-recover mid-session soft-stalls.
  const tmuxForStall = (args: string[]): Promise<string> =>
    new Promise((resolve) => {
      execFileForStallDetector("tmux", args, { encoding: "utf8" }, (err, stdout) => {
        resolve(err ? "" : stdout);
      });
    });
  behaviorRegistry.register(
    createSoftStallDetector({
      listSessions: () =>
        getSessionBridge()
          .listSessions()
          .map((s) => ({
            id: s.id,
            name: s.name,
            status: s.status,
            tmuxPane: s.tmuxPane,
            lastActivity: new Date(s.lastActivity),
          })),
      capturePane: (pane) => tmuxForStall(["capture-pane", "-t", pane, "-p"]),
      sendEnter: async (pane) => {
        await tmuxForStall(["send-keys", "-t", pane, "Enter"]);
      },
    }),
  );
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
    registerMessagingTools(server, messageStore, eventStore, conversationStore);
    registerChannelTools(server, conversationStore);
    registerStatusTools(server, messageStore, eventStore);
    registerBeadTools(server, eventStore, proposalStore, messageDb);
    registerQueryTools(server, messageStore);
    registerProposalTools(server, proposalStore);
    registerAutoDevelopTools(server, proposalStore, autoDevelopStore, { adjutantState, stimulusEngine });
    registerMemoryTools(server, memoryStore, { getAgentBySession });
    registerCoordinationTools(server, adjutantState, messageStore, stimulusEngine, eventStore, cronScheduleStore);
    registerPersonaTools(server, personaService);
    registerQuestionTools(server, questionService);
  });

  // Initialize MCP server subsystem with tool registrar.
  // Each Streamable HTTP session gets its own McpServer; the registrar
  // is called on each new instance to wire up tools.
  initMcpServer();

  // adj-6iwin: reap idle/vanished MCP sessions so leaked per-connection McpServers
  // (anonymous unknown-agent-* clients + agents that drop without a clean DELETE)
  // can't accumulate in the connections Map.
  startMcpSessionReaper();

  // adj-6iwin / MCP TS-SDK #1852: Node's default keepAliveTimeout (5s) can make
  // StreamableHTTPServerTransport tear down an MCP session when an idle TCP
  // connection closes — forcing the client to reconnect and mint a fresh
  // per-connection McpServer (reconnect churn + the leak we just fixed). MCP
  // sessions are meant to persist independently of TCP (via Mcp-Session-Id), so
  // we widen the socket keep-alive well past typical inter-request gaps; true
  // idle sessions are still reclaimed at the app layer by the reaper above.
  // headersTimeout MUST exceed keepAliveTimeout (Node constraint).
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

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
  const bridge = getSessionBridge();

  // adj-163: Wire cleanup dependencies so session death invalidates schedules/watches
  bridge.lifecycle.setCronScheduleStore(cronScheduleStore);
  bridge.lifecycle.setStimulusEngine(stimulusEngine);

  bridge
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

  // Stimulus engine wake callback — adj-163.2: route to correct agent session
  stimulusEngine.onWake((reason) => {
    const bridge = getSessionBridge();

    void handleWakeRouting(reason, {
      coordinatorTmuxSession: ADJUTANT_TMUX_SESSION,

      findByTmuxSession: (tmux) => bridge.registry.findByTmuxSession(tmux),

      sendInput: (sessionId, text) => bridge.sendInput(sessionId, text),

      disableSchedule: (scheduleId) => {
        cronScheduleStore.disable(scheduleId);
      },

      // Build the full coordinator situation prompt (unchanged from pre-adj-163.2)
      buildCoordinatorPrompt: (wakeReason) => {
        const profiles = adjutantState.getAllAgentProfiles();
        const stateSnapshot: StateSnapshot = {
          activeAgents: profiles.filter(p => p.disconnectedAt === null).length,
          workingAgents: profiles.filter(p => p.lastStatus === "working").length,
          blockedAgents: profiles.filter(p => p.lastStatus === "blocked").length,
          idleAgents: profiles.filter(p => p.lastStatus === "idle").length,
          inProgressBeads: 0, // Will be populated by the adjutant via list_beads
          readyBeads: 0,      // Will be populated by the adjutant via list_beads
        };

        const lastNudgeAt = stimulusEngine.getLastNudgeAt();
        const delta: DeltaItem[] = [];
        if (lastNudgeAt) {
          const recentEvents = eventStore.getEvents({ after: lastNudgeAt, limit: 20 });
          for (const evt of recentEvents) {
            const detail = evt.detail;
            switch (evt.eventType) {
              case "status_change":
                delta.push({
                  category: "agent",
                  summary: `${evt.agentId}: ${String(detail?.["previousStatus"] ?? "?")} → ${String(detail?.["status"] ?? "?")}`,
                  timestamp: evt.createdAt,
                });
                break;
              case "announcement":
                delta.push({
                  category: "announcement",
                  summary: `${evt.agentId}: ${evt.action}`,
                  timestamp: evt.createdAt,
                });
                break;
              case "auto_develop_phase_changed":
                delta.push({
                  category: "phase",
                  summary: `${String(detail?.["previousPhase"] ?? "?")} → ${String(detail?.["newPhase"] ?? "?")}`,
                  timestamp: evt.createdAt,
                });
                break;
              case "bead_updated":
              case "bead_closed":
                delta.push({
                  category: "bead",
                  summary: evt.action,
                  timestamp: evt.createdAt,
                });
                break;
              case "proposal_completed":
                delta.push({
                  category: "proposal",
                  summary: `Proposal completed: ${String(detail?.["proposalId"] ?? "?")}`,
                  timestamp: evt.createdAt,
                });
                break;
              default:
                delta.push({
                  category: evt.eventType.replace(/_/g, " "),
                  summary: evt.action,
                  timestamp: evt.createdAt,
                });
            }
          }
        }

        return buildSituationPrompt({
          wakeReason: wakeReason.reason ?? wakeReason.type,
          signals: wakeReason.signal ? [wakeReason.signal] : [],
          contextSnapshot: signalAggregator.drain(),
          stateSnapshot,
          pendingSchedule: stimulusEngine.getPendingSchedule(),
          recentDecisions: adjutantState.getRecentDecisions(5),
          delta,
        });
      },

      onCoordinatorSuccess: (wakeReason) => {
        stimulusEngine.markNudgeSent();
        adjutantState.logDecision({
          behavior: "stimulus-engine",
          action: `wake_${wakeReason.type}`,
          target: wakeReason.reason ?? null,
          reason: wakeReason.signal ? `signal: ${wakeReason.signal.event}` : null,
        });
      },
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
