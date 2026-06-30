/**
 * The Bridge — server-side RPC tool loop (adj-202.7).
 *
 * When the avatar's model invokes a `backend_rpc` tool mid-conversation, Runway
 * routes the call (over LiveKit) to a handler running in OUR authed backend. This
 * module is that handler: it dispatches each call to the SAME read-only
 * {@link BridgeToolBridge.executeTool} the dashboard buttons use, and returns the
 * STRUCTURED result so the avatar narrates real fleet data instead of stalling on
 * "querying…" (the Phase-1 gap this closes).
 *
 * WHY SERVER-SIDE (a deliberate divergence from the original "client RPC →
 * postMessage" sketch): the Runway SDK's RPC-with-return pattern is server-side
 * only (`@runwayml/avatars-node-rpc`'s `createRpcHandler`); the React
 * `useClientEvent` hook is one-way and cannot return a value to the model. Running
 * the handler in the backend is also strictly better here — it has direct, authed
 * access to the tool bridge, so NO API key crosses to the browser and there is no
 * postMessage hop. It works identically for the iOS default mode and the dashboard
 * external mode because the loop never touches the browser.
 *
 * The avatar never speaks a project UUID, so project-scoped tools default to the
 * session's project context (`projectId`); fleet-wide tools (list_agents,
 * list_questions) treat it as an optional filter. Read-only ONLY — the dispatch
 * map is built from {@link BRIDGE_READONLY_TOOLS}, so no write tool is reachable.
 *
 * `@runwayml/avatars-node-rpc` (and its native `@livekit/rtc-node` dependency) is
 * loaded LAZILY via a dynamic import in the default handler factory, so this module
 * — and the unit tests, which inject a fake factory — typecheck and run without the
 * package physically installed. It is declared in package.json and installed at
 * deploy time.
 */

import type {
  BridgeToolBridge,
  BridgeToolRequest,
  BridgeToolResult,
} from "./bridge-tool-bridge.js";
import { BRIDGE_READONLY_TOOLS } from "./bridge-tool-bridge.js";
import { logError, logInfo } from "../utils/logger.js";

// ============================================================================
// Minimal local typings for `@runwayml/avatars-node-rpc`.
//
// Mirrors the published 0.1.0 type defs so we depend on the SHAPE, not on the
// package being resolvable at compile time (it is loaded lazily at runtime).
// ============================================================================

/** A single RPC tool handler: receives the model's args, returns a result object. */
export type RpcToolHandler = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** Pre-fetched LiveKit credentials (the `/connect_backend` response shape). */
export interface LiveKitCredentials {
  url: string;
  token: string;
  roomName: string;
}

/** Options accepted by `createRpcHandler` (subset we use). */
export interface CreateRpcHandlerOptions {
  apiKey?: string;
  sessionId?: string;
  baseUrl?: string;
  credentials?: LiveKitCredentials;
  tools: Record<string, RpcToolHandler>;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
  debug?: boolean;
}

/** The live handler `createRpcHandler` returns. */
export interface RpcHandlerLike {
  close(): Promise<void>;
  readonly connected: boolean;
}

/** The factory signature (the real one comes from `@runwayml/avatars-node-rpc`). */
export type CreateRpcHandlerFn = (options: CreateRpcHandlerOptions) => Promise<RpcHandlerLike>;

// ============================================================================
// Dispatch map
// ============================================================================

/** Delivery info returned by the send_message write path. */
export interface BridgeSendMessageResult {
  messageId: string;
  conversationId: string;
  /** Number of live recipient sessions the directive reached (0 ⇒ offline/unknown). */
  deliveredToSessions: number;
}

/**
 * The write path for the avatar's `send_message` command tool. Delivers a directive
 * to a named agent (or "user"); resolves to delivery info, or throws on failure.
 * Deliberately separate from the fail-closed read-only `executeTool` (adj-202.4.1).
 */
export type BridgeSendMessageFn = (input: { to: string; body: string }) => Promise<BridgeSendMessageResult>;

/** nudge_agent write path — poke a running agent by name. */
export type BridgeNudgeAgentFn = (input: {
  agentId: string;
  message: string;
}) => Promise<{ agentId: string; delivered: boolean }>;

/** answer_question write path — resolve an open triage question. */
export type BridgeAnswerQuestionFn = (input: {
  questionId: string;
  answerBody?: string | undefined;
  chosenOption?: string | undefined;
}) => Promise<{ questionId: string; status: string }>;

/** create_bead write path — file a work item in the (defaulted) project. */
export type BridgeCreateBeadFn = (input: {
  title: string;
  description?: string | undefined;
  type?: "epic" | "task" | "bug" | undefined;
  projectId?: string | undefined;
}) => Promise<{ beadId: string; title: string; projectId: string }>;

/**
 * spawn_worker write path (adj-202.4.5) — START a new agent. HEAVY + confirm-gated:
 * the write path NEVER spawns unless `confirm===true`; a first call (confirm omitted)
 * resolves to `{ ok:false, needsConfirmation:true, summary }` so the avatar reads the
 * plan back to the Commander before spawning.
 */
export type BridgeSpawnWorkerFn = (input: {
  agentType: string;
  task: string;
  project?: string | undefined;
  confirm?: boolean | undefined;
}) => Promise<{
  ok: boolean;
  needsConfirmation?: boolean | undefined;
  summary?: string | undefined;
  agentName?: string | undefined;
  sessionId?: string | undefined;
  project?: string | undefined;
  agentType?: string | undefined;
}>;

/**
 * Memory write paths (adj-202.6.1) — so the avatar LEARNS from the Commander: persist a
 * stated preference/decision, reinforce a reaffirmed memory, or record a correction. Each
 * reuses the real adjutant MemoryStore (Rules 4 + 9). Reversible / low-risk ⇒ no confirm gate.
 */
export type BridgeStoreMemoryFn = (input: {
  content: string;
  category: "operational" | "technical" | "coordination" | "project";
  topic: string;
  confidence?: number | undefined;
}) => Promise<{ id: number; category: string; topic: string }>;

export type BridgeReinforceMemoryFn = (input: {
  id: number;
}) => Promise<{ id: number; reinforced: boolean; confidence?: number | undefined; reinforcementCount?: number | undefined }>;

export type BridgeRecordCorrectionFn = (input: {
  correctionType: string;
  wrongPattern: string;
  rightPattern: string;
  context?: string | undefined;
}) => Promise<{ id: number; isNew: boolean }>;

export interface BridgeToolDispatchDeps {
  /** The read-only tool bridge to delegate every read call to. */
  executeTool: BridgeToolBridge["executeTool"];
  /** Project context for project-scoped tools (the session's selected project). */
  defaultProjectId?: string | undefined;
  /** Optional sink fired with each tool result (e.g. to surface in the dashboard). */
  onResult?: ((result: BridgeToolResult) => void) | undefined;
  /**
   * Optional WRITE/command paths (adj-202.4). Each command tool is registered ONLY
   * when its write path is provided — fail-closed by default; the read-only
   * `executeTool` bridge stays untouched. All are reversible (no confirm gate).
   */
  sendMessage?: BridgeSendMessageFn | undefined;
  nudgeAgent?: BridgeNudgeAgentFn | undefined;
  answerQuestion?: BridgeAnswerQuestionFn | undefined;
  createBead?: BridgeCreateBeadFn | undefined;
  /** spawn_worker — HEAVY + confirm-gated (adj-202.4.5); registered only when provided. */
  spawnWorker?: BridgeSpawnWorkerFn | undefined;
  /** Memory write paths (adj-202.6.1); each registered only when its write path is provided. */
  storeMemory?: BridgeStoreMemoryFn | undefined;
  reinforceMemory?: BridgeReinforceMemoryFn | undefined;
  recordCorrection?: BridgeRecordCorrectionFn | undefined;
  /**
   * Optional activity sink (adj-202.6.2 auto-learn): fired with every tool call (read AND
   * write) and the call's resulting `ok` flag, so a per-session collector can distill the
   * session's usage pattern into the memory store on session end. Never used for control flow.
   */
  onActivity?: ((tool: string, ok: boolean) => void) | undefined;
}

/** A structured INVALID_ARGS envelope for a command tool (never throws to the model). */
function invalidArgs(tool: string, message: string): Record<string, unknown> {
  return { ok: false, tool, error: { code: "INVALID_ARGS", message } };
}

/** Wrap a command write-path call so an unexpected throw becomes a structured error. */
async function runCommand(
  tool: string,
  fn: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, tool, error: { code: "COMMAND_FAILED", message } };
  }
}

/**
 * Build the `{ toolName: handler }` map `createRpcHandler` needs. Each handler:
 *   1. maps the model's args to a {@link BridgeToolRequest} (injecting the default
 *      projectId so project-scoped tools resolve without the avatar speaking a UUID),
 *   2. delegates to `executeTool` (the single read-only control plane),
 *   3. returns the structured result envelope for the model to narrate.
 *
 * It NEVER rejects: an unexpected throw is converted into a structured error
 * envelope so the avatar can apologise instead of hanging until Runway times out.
 */
export function buildBridgeToolDispatch(deps: BridgeToolDispatchDeps): Record<string, RpcToolHandler> {
  const dispatch: Record<string, RpcToolHandler> = {};

  for (const tool of BRIDGE_READONLY_TOOLS) {
    dispatch[tool] = async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      try {
        const req: BridgeToolRequest = { tool, args };
        if (deps.defaultProjectId !== undefined) req.projectId = deps.defaultProjectId;

        const result = await deps.executeTool(req);
        deps.onResult?.(result);

        const payload = result.ok
          ? { ok: true, tool: result.tool, projectId: result.projectId, data: result.data }
          : { ok: false, tool: result.tool, projectId: result.projectId, error: result.error };
        // Diagnostic: the Runway tool-RPC rejects oversized returns with "RPC cancelled or failed"
        // AFTER our handler succeeds (no error on our side), so log the serialized size of every
        // result — this is the only place we can see a too-large payload that the avatar can't.
        logInfo("bridge tool call", { tool, ok: result.ok, bytes: JSON.stringify(payload).length });
        return payload;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const errResult: BridgeToolResult = {
          ok: false,
          tool,
          projectId: deps.defaultProjectId ?? null,
          error: { code: "TOOL_FAILED", message },
        };
        deps.onResult?.(errResult);
        return { ok: false, tool, projectId: errResult.projectId, error: errResult.error };
      }
    };
  }

  // send_message — the lone WRITE/command tool (adj-202.4.1), wired only when a write
  // path is provided. Deliberately NOT routed through the fail-closed read-only bridge.
  const sendMessage = deps.sendMessage;
  if (sendMessage) {
    dispatch["send_message"] = async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const to = typeof args["to"] === "string" ? args["to"].trim() : "";
      const body = typeof args["body"] === "string" ? args["body"] : "";
      // The avatar directs agents by NAME — no project/epic/bead id is ever required.
      if (!to || !body) {
        return {
          ok: false,
          tool: "send_message",
          error: { code: "INVALID_ARGS", message: "send_message requires both 'to' (agent name) and 'body'." },
        };
      }
      try {
        const result = await sendMessage({ to, body });
        return {
          ok: true,
          tool: "send_message",
          to,
          messageId: result.messageId,
          deliveredToSessions: result.deliveredToSessions,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, tool: "send_message", to, error: { code: "SEND_FAILED", message } };
      }
    };
  }

  // nudge_agent — poke a running agent by name (adj-202.4.2).
  const nudgeAgent = deps.nudgeAgent;
  if (nudgeAgent) {
    dispatch["nudge_agent"] = (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const agentId = typeof args["agentId"] === "string" ? args["agentId"].trim() : "";
      const message = typeof args["message"] === "string" ? args["message"] : "";
      if (!agentId || !message) {
        return Promise.resolve(
          invalidArgs("nudge_agent", "nudge_agent requires both 'agentId' (agent name) and 'message'."),
        );
      }
      return runCommand("nudge_agent", async () => {
        const result = await nudgeAgent({ agentId, message });
        return { ok: true, tool: "nudge_agent", agentId: result.agentId, delivered: result.delivered };
      });
    };
  }

  // answer_question — resolve an open triage question (adj-202.4.3).
  const answerQuestion = deps.answerQuestion;
  if (answerQuestion) {
    dispatch["answer_question"] = (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const questionId = typeof args["questionId"] === "string" ? args["questionId"].trim() : "";
      const answerBody = typeof args["answerBody"] === "string" && args["answerBody"].length > 0 ? args["answerBody"] : undefined;
      const chosenOption =
        typeof args["chosenOption"] === "string" && args["chosenOption"].length > 0 ? args["chosenOption"] : undefined;
      // Answer contract: questionId + at least one of answerBody / chosenOption.
      if (!questionId || (answerBody === undefined && chosenOption === undefined)) {
        return Promise.resolve(
          invalidArgs(
            "answer_question",
            "answer_question requires 'questionId' and at least one of 'answerBody' or 'chosenOption'.",
          ),
        );
      }
      return runCommand("answer_question", async () => {
        const input: { questionId: string; answerBody?: string; chosenOption?: string } = { questionId };
        if (answerBody !== undefined) input.answerBody = answerBody;
        if (chosenOption !== undefined) input.chosenOption = chosenOption;
        const result = await answerQuestion(input);
        return { ok: true, tool: "answer_question", questionId: result.questionId, status: result.status };
      });
    };
  }

  // create_bead — file a work item; defaults to the session's selected project (adj-202.4.4).
  const createBead = deps.createBead;
  if (createBead) {
    dispatch["create_bead"] = (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const title = typeof args["title"] === "string" ? args["title"].trim() : "";
      const description = typeof args["description"] === "string" && args["description"].length > 0 ? args["description"] : undefined;
      const rawType = typeof args["type"] === "string" ? args["type"] : undefined;
      if (!title) {
        return Promise.resolve(invalidArgs("create_bead", "create_bead requires a 'title'."));
      }
      if (rawType !== undefined && rawType !== "epic" && rawType !== "task" && rawType !== "bug") {
        return Promise.resolve(invalidArgs("create_bead", "create_bead 'type' must be one of: epic, task, bug."));
      }
      return runCommand("create_bead", async () => {
        const input: { title: string; description?: string; type?: "epic" | "task" | "bug"; projectId?: string } = {
          title,
        };
        if (description !== undefined) input.description = description;
        if (rawType !== undefined) input.type = rawType;
        // The avatar never speaks a UUID — inject the session's selected project.
        if (deps.defaultProjectId !== undefined) input.projectId = deps.defaultProjectId;
        const result = await createBead(input);
        return { ok: true, tool: "create_bead", beadId: result.beadId, title: result.title, projectId: result.projectId };
      });
    };
  }

  // spawn_worker — START a new agent (adj-202.4.5). HEAVY: the write path enforces the
  // read-back / confirm gate (never spawns unless confirm===true). Here we only validate
  // the model's args and pass `confirm` straight through to the gate.
  const spawnWorker = deps.spawnWorker;
  if (spawnWorker) {
    dispatch["spawn_worker"] = (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const agentType = typeof args["agentType"] === "string" ? args["agentType"].trim() : "";
      const task = typeof args["task"] === "string" ? args["task"].trim() : "";
      const project = typeof args["project"] === "string" && args["project"].trim().length > 0 ? args["project"].trim() : undefined;
      const confirm = args["confirm"] === true;
      if (!agentType || !task) {
        return Promise.resolve(invalidArgs("spawn_worker", "spawn_worker requires 'agentType' (role) and 'task'."));
      }
      return runCommand("spawn_worker", async () => {
        const input: { agentType: string; task: string; confirm: boolean; project?: string } = { agentType, task, confirm };
        // An explicit project NAME wins; otherwise default to the session's selected project.
        if (project !== undefined) input.project = project;
        else if (deps.defaultProjectId !== undefined) input.project = deps.defaultProjectId;
        const result = await spawnWorker(input);
        return { tool: "spawn_worker", ...result };
      });
    };
  }

  // store_memory — persist a learning the Commander stated (adj-202.6.1). Reversible.
  const storeMemory = deps.storeMemory;
  if (storeMemory) {
    dispatch["store_memory"] = (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const content = typeof args["content"] === "string" ? args["content"].trim() : "";
      const topic = typeof args["topic"] === "string" ? args["topic"].trim() : "";
      const rawCategory = typeof args["category"] === "string" ? args["category"] : "";
      const confidence = typeof args["confidence"] === "number" ? args["confidence"] : undefined;
      if (!content || !topic) {
        return Promise.resolve(invalidArgs("store_memory", "store_memory requires 'content' and 'topic'."));
      }
      if (rawCategory !== "operational" && rawCategory !== "technical" && rawCategory !== "coordination" && rawCategory !== "project") {
        return Promise.resolve(
          invalidArgs("store_memory", "store_memory 'category' must be one of: operational, technical, coordination, project."),
        );
      }
      return runCommand("store_memory", async () => {
        const input: { content: string; category: "operational" | "technical" | "coordination" | "project"; topic: string; confidence?: number } = {
          content,
          category: rawCategory,
          topic,
        };
        if (confidence !== undefined) input.confidence = confidence;
        const result = await storeMemory(input);
        return { ok: true, tool: "store_memory", id: result.id, category: result.category, topic: result.topic };
      });
    };
  }

  // reinforce_memory — strengthen an existing learning the Commander reaffirmed (adj-202.6.1).
  const reinforceMemory = deps.reinforceMemory;
  if (reinforceMemory) {
    dispatch["reinforce_memory"] = (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const id = typeof args["id"] === "number" ? args["id"] : NaN;
      if (!Number.isInteger(id)) {
        return Promise.resolve(invalidArgs("reinforce_memory", "reinforce_memory requires a numeric 'id'."));
      }
      return runCommand("reinforce_memory", async () => {
        const result = await reinforceMemory({ id });
        return { ok: true, tool: "reinforce_memory", id: result.id, reinforced: result.reinforced, confidence: result.confidence, reinforcementCount: result.reinforcementCount };
      });
    };
  }

  // record_correction — capture a wrong→right correction the Commander gave (adj-202.6.1).
  const recordCorrection = deps.recordCorrection;
  if (recordCorrection) {
    dispatch["record_correction"] = (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const correctionType = typeof args["correctionType"] === "string" ? args["correctionType"].trim() : "";
      const wrongPattern = typeof args["wrongPattern"] === "string" ? args["wrongPattern"].trim() : "";
      const rightPattern = typeof args["rightPattern"] === "string" ? args["rightPattern"].trim() : "";
      const context = typeof args["context"] === "string" && args["context"].length > 0 ? args["context"] : undefined;
      if (!correctionType || !wrongPattern || !rightPattern) {
        return Promise.resolve(
          invalidArgs("record_correction", "record_correction requires 'correctionType', 'wrongPattern', and 'rightPattern'."),
        );
      }
      return runCommand("record_correction", async () => {
        const input: { correctionType: string; wrongPattern: string; rightPattern: string; context?: string } = {
          correctionType,
          wrongPattern,
          rightPattern,
        };
        if (context !== undefined) input.context = context;
        const result = await recordCorrection(input);
        return { ok: true, tool: "record_correction", id: result.id, isNew: result.isNew };
      });
    };
  }

  // adj-202.6.2 — auto-learn: wrap every handler (read + write) so each tool call is reported
  // to the activity sink with the call's resulting `ok`. Done once here (DRY) rather than at
  // each return point; the sink is purely observational and never alters the envelope returned
  // to the model. The wrapper inherits each handler's never-throw guarantee.
  const onActivity = deps.onActivity;
  if (onActivity) {
    for (const name of Object.keys(dispatch)) {
      const inner = dispatch[name]!;
      dispatch[name] = async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
        const out = await inner(args);
        try {
          onActivity(name, (out as { ok?: unknown }).ok === true);
        } catch {
          // An observer fault must never break the tool call.
        }
        return out;
      };
    }
  }

  return dispatch;
}

// ============================================================================
// Handler lifecycle manager
// ============================================================================

export interface BridgeRpcManagerConfig {
  /** The read-only tool bridge every attached handler dispatches to. */
  executeTool: BridgeToolBridge["executeTool"];
  /** Runway secret for the LiveKit /connect_backend join. Defaults to env. */
  apiKey?: string | undefined;
  /** Injectable factory (defaults to the real `@runwayml/avatars-node-rpc`). */
  createHandler?: CreateRpcHandlerFn;
  /** Sink fired with every tool result across all sessions (dashboard surfacing). */
  onResult?: ((sessionId: string, result: BridgeToolResult) => void) | undefined;
  /**
   * Optional WRITE/command paths (adj-202.4). Each enables its command tool on every
   * attached session; omitting them leaves the avatar read-only. All are reversible.
   */
  sendMessage?: BridgeSendMessageFn | undefined;
  nudgeAgent?: BridgeNudgeAgentFn | undefined;
  answerQuestion?: BridgeAnswerQuestionFn | undefined;
  createBead?: BridgeCreateBeadFn | undefined;
  /** spawn_worker — HEAVY + confirm-gated (adj-202.4.5). */
  spawnWorker?: BridgeSpawnWorkerFn | undefined;
  /** Memory write paths (adj-202.6.1) — let the avatar LEARN from the Commander. */
  storeMemory?: BridgeStoreMemoryFn | undefined;
  reinforceMemory?: BridgeReinforceMemoryFn | undefined;
  recordCorrection?: BridgeRecordCorrectionFn | undefined;
  /**
   * Auto-learn hooks (adj-202.6.2). `recordActivity` is fired with each tool call on a session
   * so a collector can accumulate it; `finalizeSession` is fired when the session ends
   * (disconnect or explicit close) so the collector can distill + persist the session's pattern.
   * Both optional: omit them and the avatar simply doesn't learn implicitly from sessions.
   */
  recordActivity?: ((sessionId: string, tool: string, ok: boolean) => void) | undefined;
  finalizeSession?: ((sessionId: string) => void) | undefined;
  /**
   * adj-202.6.6 — session-end transcript hook. Fired once per session when it ends (disconnect
   * OR explicit close) so the transcript can be fetched from Runway's conversations REST API and
   * persisted into the Commander↔coordinator conversation, making the Bridge a persistent chat
   * with default history. It must be best-effort + idempotent (it may fire from BOTH the
   * disconnect and close paths); it never affects session teardown. Omit it and sessions are not
   * persisted as chat history (the pre-6.6 behaviour).
   */
  onSessionEnd?: ((sessionId: string) => void) | undefined;
}

export interface AttachOptions {
  sessionId: string;
  /** The session's selected project (default for project-scoped tools). */
  projectId?: string | undefined;
}

export interface BridgeRpcManager {
  /** Join the session's room and start serving read-only tool calls. Never throws. */
  attach(opts: AttachOptions): Promise<void>;
  /** Close + forget one session's handler. */
  close(sessionId: string): Promise<void>;
  /** Close + forget every active handler (shutdown). */
  closeAll(): Promise<void>;
  /** Whether a handler is currently registered for the session. */
  has(sessionId: string): boolean;
}

/**
 * The default handler factory: lazily imports `@runwayml/avatars-node-rpc` so the
 * native LiveKit dependency is only loaded when a real session attaches (never in
 * unit tests, which inject a fake). The variable specifier keeps `tsc` from trying
 * to resolve the optional package at compile time.
 */
const defaultCreateHandler: CreateRpcHandlerFn = async (options) => {
  const moduleName = "@runwayml/avatars-node-rpc";
  // A variable specifier keeps `tsc` from resolving the optional native package at
  // compile time; cast the dynamic import to the slice of its API we use (its real
  // type defs match — see the local CreateRpcHandlerFn typing above).
  const mod = (await import(/* @vite-ignore */ moduleName)) as { createRpcHandler: CreateRpcHandlerFn };
  return mod.createRpcHandler(options);
};

/**
 * Create the manager that owns the avatar tool-loop handlers. One handler per live
 * session, dispatching to the read-only tool bridge.
 *
 * adj-202.6.6 — the transcript is no longer captured at the transport layer (Runway GWM-1
 * publishes no `lk.transcription` streams; the room-owning factory + lk.transcription listener
 * have been retired). The tool loop uses the upstream `@runwayml/avatars-node-rpc` factory
 * unchanged; the transcript is fetched from Runway's REST API on session end via `onSessionEnd`.
 */
export function createBridgeRpcManager(config: BridgeRpcManagerConfig): BridgeRpcManager {
  // An injected factory always wins (tests); otherwise the upstream factory runs unchanged.
  const createHandler = config.createHandler ?? defaultCreateHandler;
  const apiKey = config.apiKey ?? process.env["RUNWAYML_API_SECRET"];
  const resultSink = config.onResult;
  const handlers = new Map<string, RpcHandlerLike>();

  async function attach(opts: AttachOptions): Promise<void> {
    const { sessionId, projectId } = opts;

    const dispatch = buildBridgeToolDispatch({
      executeTool: config.executeTool,
      defaultProjectId: projectId,
      onResult: resultSink ? (result) => { resultSink(sessionId, result); } : undefined,
      sendMessage: config.sendMessage,
      nudgeAgent: config.nudgeAgent,
      answerQuestion: config.answerQuestion,
      createBead: config.createBead,
      spawnWorker: config.spawnWorker,
      storeMemory: config.storeMemory,
      reinforceMemory: config.reinforceMemory,
      recordCorrection: config.recordCorrection,
      // adj-202.6.2 — feed each tool call to the session collector under this session's id.
      onActivity: config.recordActivity
        ? (tool, ok) => { config.recordActivity!(sessionId, tool, ok); }
        : undefined,
    });

    try {
      const handlerOpts: CreateRpcHandlerOptions = {
        tools: dispatch,
        onDisconnected: () => {
          handlers.delete(sessionId);
          // adj-202.6.2 — session ended: let the collector distill + persist what was learned.
          config.finalizeSession?.(sessionId);
          // adj-202.6.6 — fetch + persist the session's transcript as chat history (idempotent).
          config.onSessionEnd?.(sessionId);
          logInfo("bridge rpc handler disconnected", { sessionId });
        },
        onError: (error) => { logError("bridge rpc handler error", { sessionId, error: error.message }); },
      };
      if (apiKey !== undefined) handlerOpts.apiKey = apiKey;
      handlerOpts.sessionId = sessionId;

      const handler = await createHandler(handlerOpts);
      handlers.set(sessionId, handler);
      logInfo("bridge rpc handler attached", { sessionId, projectId: projectId ?? null });
    } catch (err) {
      // The session is already live and billable; a failed tool-loop attach must not
      // tear it down. The avatar still talks — it just can't query the fleet.
      logError("bridge rpc handler attach failed", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function close(sessionId: string): Promise<void> {
    const handler = handlers.get(sessionId);
    if (!handler) return;
    handlers.delete(sessionId);
    // adj-202.6.2 — an explicit close is also a session end. finalize is idempotent, so a later
    // onDisconnected (which handler.close() may trigger) is a harmless no-op.
    config.finalizeSession?.(sessionId);
    // adj-202.6.6 — fetch + persist the transcript on explicit close too. onSessionEnd is
    // idempotent, so a later onDisconnected firing the same hook is a harmless no-op.
    config.onSessionEnd?.(sessionId);
    try {
      await handler.close();
    } catch (err) {
      logError("bridge rpc handler close failed", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function closeAll(): Promise<void> {
    const ids = [...handlers.keys()];
    await Promise.all(ids.map((id) => close(id)));
  }

  return {
    attach,
    close,
    closeAll,
    has: (sessionId) => handlers.has(sessionId),
  };
}
