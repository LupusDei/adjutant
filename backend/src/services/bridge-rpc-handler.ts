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

/** Options accepted by `createRpcHandler` (subset we use). */
export interface CreateRpcHandlerOptions {
  apiKey?: string;
  sessionId?: string;
  baseUrl?: string;
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

export interface BridgeToolDispatchDeps {
  /** The read-only tool bridge to delegate every call to. */
  executeTool: BridgeToolBridge["executeTool"];
  /** Project context for project-scoped tools (the session's selected project). */
  defaultProjectId?: string | undefined;
  /** Optional sink fired with each tool result (e.g. to surface in the dashboard). */
  onResult?: ((result: BridgeToolResult) => void) | undefined;
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

        if (result.ok) {
          return { ok: true, tool: result.tool, projectId: result.projectId, data: result.data };
        }
        return { ok: false, tool: result.tool, projectId: result.projectId, error: result.error };
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
 */
export function createBridgeRpcManager(config: BridgeRpcManagerConfig): BridgeRpcManager {
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
    });

    try {
      const handlerOpts: CreateRpcHandlerOptions = {
        tools: dispatch,
        onDisconnected: () => {
          handlers.delete(sessionId);
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
