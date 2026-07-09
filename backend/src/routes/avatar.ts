/**
 * The Bridge — avatar routes (adj-202.2.1 / adj-202.2.4 / adj-202.7.1).
 *
 * Two public, no-API-key endpoints (mounted BEFORE apiKeyAuth, like /p):
 *   POST /avatar/connect  -> cost-guarded broker session, returns { sessionId, sessionKey, avatarId, expiresAt }
 *   GET  /avatar          -> a self-contained web client (loads @runwayml/avatars-react from a CDN,
 *                            fetches /avatar/connect, renders <AvatarCall>). Loaded by the iOS WKWebView overlay.
 *
 * The secret RUNWAYML_API_SECRET stays server-side; the browser only ever sees the short-lived
 * sessionKey. These stay intentionally unauthenticated so the WKWebView page can call /connect
 * same-origin without the dashboard API key.
 *
 * adj-202.7.1: /avatar/connect now goes through the SAME `BridgeSessionBroker` +
 * `BridgeRpcManager` the dashboard uses (it previously called the un-guarded,
 * un-tool-enabled `createReadyAvatarSession`). So the iOS/default avatar gets (a) the
 * read-only fleet tool loop — "what's the agent roster?" actually queries — and (b)
 * the daily credit ceiling + cost guard. The response contract is unchanged. This also
 * retires the duplicate create+poll lifecycle (DRY — adj-202.3.4.1).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Router } from "express";
import { z } from "zod";

import type {
  BridgeSessionBroker,
  StartSessionOptions,
  BridgeSessionCreds,
  NativeConsumerCreds,
} from "../services/bridge-session-broker.js";
import { BridgeCostCeilingError } from "../services/bridge-session-broker.js";
import type { BridgeRpcManager } from "../services/bridge-rpc-handler.js";
import { BRIDGE_RPC_TOOLS, composeBridgePersonality } from "../services/bridge-rpc-tools.js";
import { appendMemorySeed } from "../services/bridge-memory-seed.js";
import { logError, logInfo } from "../utils/logger.js";

/** The slice of each service the avatar router needs (keeps it testable with fakes). */
export interface AvatarRouterDeps {
  broker: Pick<BridgeSessionBroker, "startSession">;
  /**
   * Server-side read-only tool loop (adj-202.7.1). When present, every avatar
   * session gets a handler attached so the avatar can query the fleet. `attach`
   * never throws, so it cannot break a (billable) session.
   */
  rpcManager?: Pick<BridgeRpcManager, "attach">;
  /**
   * Re-validate a cached warm session is still consumable before handing it out
   * (adj-202.10.1). Returns the session's current Runway status (e.g. "READY"),
   * or rejects if the lookup fails. When omitted, no validation is done and the
   * warm session is served as-is. Real wiring passes `broker.getSessionStatus`.
   */
  getSessionStatus?: (sessionId: string) => Promise<string | undefined>;
  /**
   * Default project for the avatar's project-scoped tools (get_project_state, list_beads,
   * get_auto_develop_status). The iOS/default session selects no project, so without this
   * those tools error PROJECT_REQUIRED (adj-202). getProject resolves a name or UUID.
   */
  defaultProjectId?: string | undefined;
  /**
   * Memory-seeded sessions (adj-202.6.4). When provided, its result is appended to the
   * avatar's personality so the iOS/default session opens already knowing the Commander's
   * high-signal preferences/decisions + recent corrections. Returns null on a blank-slate
   * memory (⇒ no change). The seed is computed when a session is created — including when a
   * warm session is pre-provisioned — which is acceptable: memories change slowly.
   */
  buildMemorySeed?: (() => string | null) | undefined;
  /**
   * Mint room-scoped LiveKit join creds for a READ-ONLY NATIVE consumer of the CURRENT avatar
   * session (adj-207.4.5). Powers `POST /avatar/native-token`: the iOS native LiveKit client
   * (Phase B) subscribes to the SAME room/avatar video track for system PiP WITHOUT starting a
   * second Runway session (no double credit burn). Real wiring passes
   * `broker.getNativeConsumerCreds`. When omitted, the route returns 501 (feature not wired).
   */
  getNativeConsumerCreds?: (sessionId: string) => Promise<NativeConsumerCreds>;
}

/** Body schema for POST /avatar/native-token. `sessionId`, if given, must match the active one. */
const nativeTokenBodySchema = z.object({ sessionId: z.string().min(1).optional() }).strip();

/**
 * Self-hosted avatar SDK bundle (adj-202): React + react-dom + @runwayml/avatars-react bundled
 * into ONE same-origin file, served at GET /avatar/sdk.js. Eliminates the esm.sh CDN module-graph
 * that caused "Importing a module script failed" on mobile. Loaded once at startup; stays null if
 * the bundle is absent (the page then falls back to esm.sh, so a missing file never crashes boot).
 */
let avatarSdkJs: string | null = null;
try {
  avatarSdkJs = readFileSync(fileURLToPath(new URL("../../public/avatar-sdk.js", import.meta.url)), "utf8");
} catch {
  avatarSdkJs = null;
}

export function createAvatarRouter(deps: AvatarRouterDeps): Router {
  const router = Router();

  // Same-origin SDK bundle — the avatar page imports this instead of the flaky esm.sh graph.
  router.get("/sdk.js", (_req, res) => {
    if (!avatarSdkJs) return res.status(404).type("text/plain").send("avatar SDK bundle not built");
    return res.type("application/javascript").set("Cache-Control", "public, max-age=86400").send(avatarSdkJs);
  });

  // ── Warm-session cache (adj-202.10, load perf) ──────────────────────────────
  // Runway takes ~3-5s to provision a session, which is the load-time floor. So we keep ONE
  // pre-provisioned, tool-enabled session ready: iOS calls POST /avatar/prepare on foreground
  // (intent), and POST /avatar/connect hands that warm session out instantly (~2s to first
  // frame instead of ~5s). We warm ONLY on explicit prepare (not after connect) so we never
  // burn credits keeping a session alive when nobody is about to use it; the cost-guard ceiling
  // still gates every create. A warm session unused past its TTL is simply dropped.
  const WARM_TTL_MS = 4 * 60 * 1000; // Runway sessions live ~5min — keep a safety buffer.
  let warm: { creds: BridgeSessionCreds; createdAt: number } | null = null;
  let warming: Promise<void> | null = null;

  // ── Active-session tracking (adj-207.4.5) ───────────────────────────────────
  // The last session handed out by POST /avatar/connect. POST /avatar/native-token vends a
  // room-scoped LiveKit token for THIS session so a native iOS LiveKit client can subscribe to the
  // same avatar video (system PiP) without spinning up a second Runway session. We track only the
  // connect-issued session (the path iOS uses); the dashboard's external-mode session is owned by
  // /api/bridge/session and is not a PiP target.
  let activeSession: BridgeSessionCreds | null = null;
  const rememberActiveSession = (creds: BridgeSessionCreds): void => {
    activeSession = creds;
  };
  // A session past its reported cap can no longer be joined — treat it as no active session.
  const currentActiveSession = (): BridgeSessionCreds | null => {
    if (!activeSession) return null;
    if (activeSession.expiresAt && Date.parse(activeSession.expiresAt) <= Date.now()) {
      activeSession = null;
      return null;
    }
    return activeSession;
  };

  const buildOpts = (customAvatarId?: string): StartSessionOptions => {
    // Tool-enable exactly like POST /api/bridge/session: read-only fleet tools + a persona that
    // tells GWM-1 to CALL them. Default mode has no selected project (fleet tools need none).
    // adj-202.6.4 — seed the persona with what the coordinator already knows (best-effort).
    let memorySeed: string | null = null;
    if (deps.buildMemorySeed) {
      try {
        memorySeed = deps.buildMemorySeed();
      } catch {
        memorySeed = null;
      }
    }
    const opts: StartSessionOptions = {
      tools: BRIDGE_RPC_TOOLS,
      personality: appendMemorySeed(composeBridgePersonality(), memorySeed),
    };
    if (customAvatarId !== undefined) opts.avatarId = customAvatarId;
    return opts;
  };

  // Create a fully-ready session: broker create+poll, then attach the tool-loop handler.
  async function createReadySession(customAvatarId?: string): Promise<BridgeSessionCreds> {
    const session = await deps.broker.startSession(buildOpts(customAvatarId));
    // `attach` swallows its own errors — a tool-loop hiccup must not fail a billable session.
    if (deps.rpcManager) {
      const attachOpts: { sessionId: string; projectId?: string } = { sessionId: session.sessionId };
      if (deps.defaultProjectId !== undefined) attachOpts.projectId = deps.defaultProjectId;
      await deps.rpcManager.attach(attachOpts);
    }
    return session;
  }

  const warmFresh = (): boolean => warm !== null && Date.now() - warm.createdAt < WARM_TTL_MS;

  // Provision a warm session in the background (idempotent + ceiling-gated). No-op if one is
  // already fresh or a warm is already in flight.
  function triggerWarm(): void {
    if (warming || warmFresh()) return;
    warming = (async () => {
      try {
        const creds = await createReadySession();
        warm = { creds, createdAt: Date.now() };
        logInfo("avatar warm session ready", { sessionId: creds.sessionId });
      } catch (err) {
        // Ceiling reached or create failed — leave the slot empty; connect falls back on-demand.
        warm = null;
        logInfo("avatar warm skipped", { error: err instanceof Error ? err.message : String(err) });
      } finally {
        warming = null;
      }
    })();
  }

  // ── Keep-warm heartbeat (adj-202.10.2, load perf) ───────────────────────────
  // Provisioning a Runway session takes ~5s. A single prepare-then-tap only hides that if the
  // Commander waits ~5s before tapping; a fast tap, a second tap, or a warm that expired/was
  // consumed all fall back to the full ~5s on-demand create — the "10s to the avatar" the
  // Commander sees. Instead we keep a session ALWAYS hot WHILE THE APP IS ACTIVE: any prepare/
  // connect marks activity and (re)starts a self-scheduling loop that re-warms whenever the slot
  // isn't fresh, until an idle window passes. So a tap lands on an already-READY session (server
  // time ~0), leaving only the unavoidable client-side connect + first-frame. The loop stops after
  // ACTIVE_WINDOW_MS of no activity so we never burn credits warming a session nobody will use; the
  // cost guard still gates every create.
  const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
  const KEEP_WARM_CHECK_MS = 20 * 1000;
  let lastActivityAt = 0;
  let keepWarmTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleKeepWarm(): void {
    if (keepWarmTimer) return;
    keepWarmTimer = setTimeout(() => {
      keepWarmTimer = null;
      if (Date.now() - lastActivityAt > ACTIVE_WINDOW_MS) return; // went idle — stop warming
      triggerWarm(); // no-op if already fresh / in flight; ceiling-gated
      scheduleKeepWarm();
    }, KEEP_WARM_CHECK_MS);
    // Don't keep the event loop (or a test process) alive just for the heartbeat.
    (keepWarmTimer as { unref?: () => void }).unref?.();
  }

  function noteActivity(): void {
    lastActivityAt = Date.now();
    triggerWarm(); // ensure a session is provisioning NOW
    scheduleKeepWarm(); // and keep one hot while the app stays active
  }

  // Take the warm session if it is still fresh AND Runway still reports it consumable;
  // otherwise drop it and return null so connect falls back to an on-demand create.
  //
  // adj-202.10.1: an unused warm session can transition to FAILED/expired before the
  // Commander taps LIVE. Handing out those stale creds made /avatar/connect return a
  // session the client cannot consume ("Cannot consume session in status: FAILED"),
  // forcing a manual second tap. We now RE-VALIDATE the status before handing it out and
  // discard anything not READY/RUNNING (or whose status lookup fails) — never hand out a
  // non-READY warm session. Validation is skipped only when no validator was wired.
  async function takeWarm(): Promise<BridgeSessionCreds | null> {
    if (!(warmFresh() && warm)) {
      warm = null;
      return null;
    }
    const creds = warm.creds;
    warm = null; // consume the slot regardless — a warm session is never reused twice.

    if (deps.getSessionStatus) {
      let status: string | undefined;
      try {
        status = await deps.getSessionStatus(creds.sessionId);
      } catch (err) {
        // A failed status lookup means we cannot prove the session is healthy — discard it.
        logInfo("avatar warm session discarded (status check failed)", {
          sessionId: creds.sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
      if (status !== "READY" && status !== "RUNNING") {
        logInfo("avatar warm session discarded (not READY)", { sessionId: creds.sessionId, status });
        return null;
      }
    }
    return creds;
  }

  // POST /avatar/prepare — warm a session ahead of a tap (called by iOS on foreground/intent).
  // Idempotent, cost-guarded, returns immediately without blocking on provisioning.
  router.post("/prepare", (_req, res) => {
    noteActivity();
    return res.json({ ok: true, warm: warmFresh() });
  });

  router.post("/connect", async (req, res) => {
    const body = req.body as { customAvatarId?: unknown } | undefined;
    const customAvatarId =
      typeof body?.customAvatarId === "string" && body.customAvatarId.length > 0 ? body.customAvatarId : undefined;

    // A connect proves the app is active — keep the next session hot so a follow-on tap is instant.
    noteActivity();

    try {
      // Fast path: hand out the pre-warmed session (default avatar only — a custom avatar can't
      // reuse the warm one). This is the ~2s path.
      if (customAvatarId === undefined) {
        const warmCreds = await takeWarm();
        // The warm slot is now consumed either way — immediately provision the NEXT one so a
        // second tap (or a quick reconnect) also lands warm instead of paying the ~5s create.
        triggerWarm();
        if (warmCreds) {
          rememberActiveSession(warmCreds); // adj-207.4.5 — native PiP consumer targets this session
          logInfo("avatar session served warm", { sessionId: warmCreds.sessionId });
          return res.json(warmCreds);
        }
      }

      // On-demand path (no warm session available).
      const session = await createReadySession(customAvatarId);
      rememberActiveSession(session); // adj-207.4.5 — native PiP consumer targets this session
      logInfo("avatar session created", { sessionId: session.sessionId, avatarId: session.avatarId });
      return res.json(session);
    } catch (err) {
      // Daily credit ceiling — expected, recoverable; surface distinctly (429) like /api/bridge/session.
      if (err instanceof BridgeCostCeilingError) {
        logError("avatar session refused (cost ceiling)", { error: err.message });
        return res.status(429).json({ success: false, error: { code: err.code, message: err.message } });
      }
      logError("avatar session create failed", { error: err instanceof Error ? err.message : String(err) });
      return res.status(502).json({
        success: false,
        error: { code: "AVATAR_SESSION_FAILED", message: err instanceof Error ? err.message : "Unknown error" },
      });
    }
  });

  // POST /avatar/native-token — vend a room-scoped LiveKit token for a READ-ONLY NATIVE consumer
  // of the CURRENT avatar session (adj-207.4.5 / adj-207 Phase B). The native iOS LiveKit client
  // joins the SAME room and subscribes to the avatar video track (to drive system PiP) WITHOUT
  // creating a second Runway session — so there is no double credit burn (this handler NEVER calls
  // broker.startSession). Rejects when no session is active. Public, same as /avatar/connect.
  router.post("/native-token", async (req, res) => {
    const parsed = nativeTokenBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid request body" },
      });
    }

    if (!deps.getNativeConsumerCreds) {
      return res.status(501).json({
        success: false,
        error: { code: "NATIVE_TOKEN_UNAVAILABLE", message: "Native avatar consumer is not configured" },
      });
    }

    const session = currentActiveSession();
    // No active session, or the caller asked for a session that isn't the active one — either way
    // there is nothing to subscribe to, and we never mint creds for an arbitrary session id.
    if (!session || (parsed.data.sessionId !== undefined && parsed.data.sessionId !== session.sessionId)) {
      return res.status(409).json({
        success: false,
        error: { code: "NO_ACTIVE_AVATAR_SESSION", message: "No active avatar session to subscribe to" },
      });
    }

    try {
      const creds = await deps.getNativeConsumerCreds(session.sessionId);
      logInfo("avatar native-token vended", { sessionId: session.sessionId, roomName: creds.roomName });
      return res.json({
        sessionId: creds.sessionId,
        roomName: creds.roomName,
        url: creds.url,
        token: creds.token,
        avatarId: session.avatarId,
        consumer: "native",
        subscribeOnly: true,
        ...(creds.expiresAt ? { expiresAt: creds.expiresAt } : {}),
      });
    } catch (err) {
      logError("avatar native-token failed", { error: err instanceof Error ? err.message : String(err) });
      return res.status(502).json({
        success: false,
        error: { code: "NATIVE_TOKEN_FAILED", message: err instanceof Error ? err.message : "Unknown error" },
      });
    }
  });

  // GET /avatar/warm-status — observability (adj-202.10.3) for the iOS overview status line.
  // Answers plainly: is a warm Bridge session ready NOW, is one provisioning, or is it idle
  // (a tap will pay the full ~5s create)? Public like the rest of /avatar; no secrets.
  router.get("/warm-status", (_req, res) => {
    const now = Date.now();
    const ready = warmFresh();
    return res.json({
      state: ready ? "ready" : warming !== null ? "warming" : "idle",
      warmReady: ready,
      warming: warming !== null,
      warmAgeMs: warm ? now - warm.createdAt : null,
      warmTtlMs: WARM_TTL_MS,
    });
  });

  // POST /avatar/native-session — start a FRESH Runway session that a NATIVE iOS LiveKit
  // client OWNS as the backend handler, for system PiP over other apps (adj-207.5.4).
  //
  // WHY a fresh session (the session-swap pivot): Runway's connect_backend allows only ONE
  // backend handler per session, and the LIVE avatar session's slot is already held by the
  // Adjutant backend's tool-loop attach — so a 2nd backend handler on the live session is
  // impossible (400 "A backend handler is already connected"). Instead, on pop-out iOS closes
  // the WKWebView session and starts THIS fresh session, whose backend-handler slot is FREE
  // because we deliberately DO NOT attach the tool loop here. The native client then
  // connect_backend's into it and (if Runway publishes video to backend handlers) renders the
  // avatar into an AVSampleBufferDisplayLayer for AVPictureInPictureController.
  //
  // v1 is CLEAN (no conversation-context carryover; no tools) — documented follow-up. The
  // single-session invariant is enforced on the CLIENT: iOS closes the WKWebView session
  // before/as this starts, so only ONE Runway session is ever live (no double credit).
  router.post("/native-session", async (req, res) => {
    const body = req.body as { customAvatarId?: unknown } | undefined;
    const customAvatarId =
      typeof body?.customAvatarId === "string" && body.customAvatarId.length > 0 ? body.customAvatarId : undefined;

    if (!deps.getNativeConsumerCreds) {
      return res.status(501).json({
        success: false,
        error: { code: "NATIVE_SESSION_UNAVAILABLE", message: "Native avatar session is not configured" },
      });
    }

    try {
      // Start a fresh session WITHOUT attaching the tool-loop handler — leaving the ONE
      // backend-handler slot free for the native client (createReadySession would consume it).
      const session = await deps.broker.startSession(buildOpts(customAvatarId));
      // Reserve the backend-handler slot + mint the native client's LiveKit join creds.
      const creds = await deps.getNativeConsumerCreds(session.sessionId);
      logInfo("avatar native-session started", {
        sessionId: session.sessionId,
        roomName: creds.roomName,
        avatarId: session.avatarId,
      });
      return res.json({
        sessionId: creds.sessionId,
        roomName: creds.roomName,
        url: creds.url,
        token: creds.token,
        avatarId: session.avatarId,
        consumer: "native",
        fresh: true,
        ...(creds.expiresAt ? { expiresAt: creds.expiresAt } : {}),
      });
    } catch (err) {
      if (err instanceof BridgeCostCeilingError) {
        logError("avatar native-session refused (cost ceiling)", { error: err.message });
        return res.status(429).json({ success: false, error: { code: err.code, message: err.message } });
      }
      logError("avatar native-session failed", { error: err instanceof Error ? err.message : String(err) });
      return res.status(502).json({
        success: false,
        error: { code: "NATIVE_SESSION_FAILED", message: err instanceof Error ? err.message : "Unknown error" },
      });
    }
  });

  router.get("/", (_req, res) => {
    res.type("html").send(AVATAR_PAGE_HTML);
  });

  return router;
}

/**
 * Self-contained avatar client page. No build step: React + the Runway avatars SDK load from esm.sh.
 * Loaded inside the iOS WKWebView overlay (and works in any browser pointed at the backend origin).
 */
const AVATAR_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Adjutant</title>
<link rel="stylesheet" href="https://esm.sh/@runwayml/avatars-react/styles.css" />
<!-- Warm the CDN connection + start fetching the SDK modules during HTML parse (load perf — adj-202). -->
<link rel="preconnect" href="https://esm.sh" crossorigin />
<link rel="dns-prefetch" href="https://esm.sh" />
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; height: 100%; color: #e7d9ee; font-family: -apple-system, system-ui, sans-serif; overflow: hidden; }
  body { background: #04020a; }

  /* Deep-space backdrop: tiled stars + brand-tinted nebula (purple #a118c4 / azure #1FB6D6) + vignette */
  .space {
    position: fixed; inset: 0; z-index: 0; pointer-events: none;
    background-color: #04020a;
    background-image:
      radial-gradient(1px 1px at 25px 35px, #ffffff, transparent),
      radial-gradient(1px 1px at 70px 90px, rgba(255,255,255,.85), transparent),
      radial-gradient(1.6px 1.6px at 130px 50px, #cfe6ff, transparent),
      radial-gradient(1px 1px at 180px 130px, #ffffff, transparent),
      radial-gradient(1.4px 1.4px at 95px 165px, rgba(255,255,255,.7), transparent),
      radial-gradient(2px 2px at 150px 20px, rgba(255,255,255,.95), transparent),
      radial-gradient(ellipse 60% 50% at 74% 20%, rgba(161,24,196,.34), transparent 60%),
      radial-gradient(ellipse 55% 45% at 20% 82%, rgba(31,182,214,.24), transparent 60%),
      radial-gradient(circle at 50% 45%, rgba(24,10,46,.55), #04020a 78%);
    background-size: 200px 200px, 200px 200px, 220px 220px, 200px 200px, 200px 200px, 260px 260px, 100% 100%, 100% 100%, 100% 100%;
    background-repeat: repeat, repeat, repeat, repeat, repeat, repeat, no-repeat, no-repeat, no-repeat;
  }

  /* Avatar layer — fill the screen in PORTRAIT. The SDK call widget is
     [data-avatar-call] { width:100%; aspect-ratio:16/9 } — a landscape strip pinned at
     the top. Override THAT container to full-viewport (height-driven, dvh for mobile);
     its inner [data-avatar-video] video already does object-fit:cover, so the landscape
     source crops to a full-screen portrait. (Targeting the SDK's own container is what
     finally works — its ::before filter:blur() traps position:fixed, so my earlier
     viewport-fixed video override never applied.) */
  #root { position: fixed; inset: 0; z-index: 1; overflow: hidden; }
  #root, #root * { background-color: transparent !important; }
  [data-avatar-call] {
    width: 100vw !important;
    height: 100vh !important;
    height: 100dvh !important;
    aspect-ratio: auto !important;
    max-width: none !important;
    max-height: none !important;
  }
  /* The widget is now full-screen (position:relative). Absolutely fill the REMOTE avatar
     video to it, cover-cropped → centered full-screen portrait. Absolute (not fixed) so the
     widget's ::before filter:blur() doesn't trap it; the widget itself is the positioned
     ancestor. Scoped to [data-avatar-video] so it does NOT also blow up the self-view PiP. */
  [data-avatar-video], [data-avatar-video] > * { position: absolute !important; inset: 0 !important; height: 100% !important; width: 100% !important; }
  [data-avatar-video] video, [data-avatar-video] canvas {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
  }

  /* Self-view (Commander's front camera, adj-202.5.1) — small rounded PiP, top-left, above
     the avatar. Absolute (not fixed) to dodge the blur-trap. Hidden when the camera is off. */
  [data-avatar-user-video] {
    position: absolute !important;
    top: calc(12px + env(safe-area-inset-top)); left: 12px; z-index: 3;
    width: 28vw; max-width: 132px; aspect-ratio: 3 / 4;
    border-radius: 10px; overflow: hidden;
    border: 1px solid rgba(31,182,214,.55); box-shadow: 0 4px 18px rgba(0,0,0,.55);
    background: #000 !important;
  }
  [data-avatar-user-video][data-avatar-has-video="false"] { display: none !important; }
  [data-avatar-user-video] video {
    position: absolute !important; inset: 0 !important;
    width: 100% !important; height: 100% !important; object-fit: cover !important;
  }

  /* Shared-surface preview (adj-202.5.2) — top-right PiP, mirrors the self-view. The SDK
     only renders [data-avatar-screen-share] while sharing, so no explicit hide rule needed. */
  [data-avatar-screen-share] {
    position: absolute !important;
    top: calc(12px + env(safe-area-inset-top)); right: 12px; z-index: 3;
    width: 36vw; max-width: 220px; aspect-ratio: 16 / 10;
    border-radius: 10px; overflow: hidden;
    border: 1px solid rgba(161,24,196,.55); box-shadow: 0 4px 18px rgba(0,0,0,.55);
    background: #000 !important;
  }
  [data-avatar-screen-share] video {
    position: absolute !important; inset: 0 !important;
    width: 100% !important; height: 100% !important; object-fit: contain !important;
  }

  /* On-screen media controls (default mode — iOS / standalone). Pinned bottom, above the
     status line. The dashboard (external mode) renders its own chrome controls instead. */
  .bridge-controls {
    position: fixed; left: 0; right: 0; bottom: calc(46px + env(safe-area-inset-bottom));
    z-index: 4; display: flex; gap: 12px; justify-content: center; pointer-events: none;
  }
  .bridge-ctrl {
    pointer-events: auto; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    min-height: 44px; padding: 10px 18px; border-radius: 999px; /* >=44px tap target (iOS) */
    border: 1px solid rgba(255,136,0,.7); background: rgba(8,4,16,.62) !important;
    color: #ffab4d; font-family: inherit; font-size: 14px; letter-spacing: .04em;
    cursor: pointer; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  }
  .bridge-ctrl.on { border-color: rgba(31,182,214,.75); color: #7fe8ff; }
  .bridge-ctrl:focus-visible { outline: 2px solid #7fe8ff; outline-offset: 2px; }

  /* "Camera live" badge (adj-202.5.5) — unambiguous signal the front camera is on,
     pairs with the self-view PiP. Top-center so it reads regardless of PiP size. */
  .bridge-live {
    position: fixed; top: calc(12px + env(safe-area-inset-top)); left: 50%; transform: translateX(-50%);
    z-index: 5; display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 12px; border-radius: 999px; font-size: 12px; letter-spacing: .06em;
    color: #7fe8ff; background: rgba(8,4,16,.66) !important; border: 1px solid rgba(31,182,214,.55);
  }

  /* "Sharing your screen" indicator (adj-202.5.6) — persistent while a surface is shared,
     with a one-tap Stop. (Stacked below the camera-live badge if both are present.) */
  .bridge-sharing {
    position: fixed; top: calc(56px + env(safe-area-inset-top)); left: 50%; transform: translateX(-50%);
    z-index: 5; display: inline-flex; align-items: center; gap: 10px;
    padding: 8px 12px 8px 14px; border-radius: 999px; font-size: 13px;
    color: #e6b8ff; background: rgba(8,4,16,.72) !important; border: 1px solid rgba(161,24,196,.6);
  }
  .bridge-sharing .bridge-ctrl { min-height: 32px; padding: 4px 12px; font-size: 12px; }

  /* Permission-blocked banner (adj-202.5.4) — friendly guidance instead of a raw
     getUserMedia NotAllowedError when the OS-level camera/mic permission is denied. */
  .bridge-perm {
    position: fixed; left: 16px; right: 16px; top: 50%; transform: translateY(-50%);
    z-index: 6; display: flex; flex-direction: column; align-items: center; gap: 12px;
    max-width: 420px; margin: 0 auto; padding: 18px 20px; border-radius: 14px; text-align: center;
    color: #ffd9d9; background: rgba(8,4,16,.94) !important; border: 1px solid rgba(255,142,142,.6);
    font-size: 14px; line-height: 1.45;
  }
  .bridge-perm-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }

  #status { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2; padding: 12px 16px env(safe-area-inset-bottom); text-align: center; font-size: 14px; color: #c9a0e0; }
  #status.err { color: #ff8e8e; }
  .spin { display:inline-block; width:14px;height:14px;border:2px solid #a118c4;border-top-color:transparent;border-radius:50%;animation:s .8s linear infinite;vertical-align:-2px;margin-right:8px;}
  @keyframes s { to { transform: rotate(360deg);} }
</style>
</head>
<body>
<div class="space"></div>
<div id="root"></div>
<div id="status"><span class="spin"></span>Connecting to the Adjutant…</div>
<script type="module">
  const statusEl = document.getElementById('status');
  const setStatus = (msg, isErr) => { statusEl.innerHTML = msg; statusEl.className = isErr ? 'err' : ''; };
  // EXTERNAL mode (adj-202.3.7.3): the dashboard BridgePanel loads /avatar?external=1
  // and hands off ONE broker-owned session via postMessage, so the iframe must NOT
  // self-connect (no second session = no double-billing, ceiling-gated). Default mode
  // (no param — e.g. the iOS WKWebView overlay) self-connects, unchanged.
  const external = new URLSearchParams(location.search).has('external');
  const post = (m) => { try { if (window.parent && window.parent !== window) window.parent.postMessage(m, location.origin); } catch (_) {} };
  // Fetch a fresh on-demand session from the backend. Reused for the initial connect AND
  // for the one-shot consume-failure retry below (adj-202.10.1).
  const fetchSession = () =>
    fetch('/avatar/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(async (res) => {
        if (!res.ok) { const t = await res.text(); throw new Error('Session failed (' + res.status + '): ' + t); }
        return res.json();
      });
  // PERF (adj-202): start the session create IMMEDIATELY (default mode) so Runway provisions the
  // avatar WHILE the SDK downloads — the two slowest steps now overlap instead of running back to
  // back. External mode receives its creds from the parent, so it does not self-fetch.
  const sessionPromise = external ? null : fetchSession();
  if (sessionPromise) sessionPromise.catch(() => {}); // pre-handle: avoid unhandled rejection if imports fail first
  try {
    // Load the SDK modules SERIALLY — the proven order (react first so react-dom and
    // avatars-react resolve it from cache). Parallel Promise.all imports + modulepreload tripped
    // a WKWebView "Importing a module script failed". The session fetch above already overlaps
    // the slowest part, so the imports don't need to be parallelized.
    // PRIMARY: the self-hosted SDK bundle — ONE same-origin file (React + react-dom +
    // avatars-react + LiveKit all inlined), so there is NO esm.sh CDN module graph to fail on a
    // mobile WKWebView. FALLBACK: if the local bundle can't load, drop to esm.sh ?bundle, so this
    // can never regress below the prior behaviour. Either path yields one consistent React.
    let sdk;
    try {
      sdk = await import('/avatar/sdk.js');
    } catch (_e) {
      const r = (await import('https://esm.sh/react@18')).default;
      const { createRoot: cr } = await import('https://esm.sh/react-dom@18/client');
      const m = await import('https://esm.sh/@runwayml/avatars-react?bundle&deps=react@18,react-dom@18');
      sdk = { React: r, createRoot: cr, ...m };
    }
    const React = sdk.React;
    const { createRoot, AvatarCall, AvatarVideo, UserVideo, ScreenShareVideo, useLocalMedia } = sdk;
    const h = React.createElement;
    const root = createRoot(document.getElementById('root'));

    // Screen-share (adj-202.5.2) needs getDisplayMedia, which iOS Safari / WKWebView do
    // NOT implement — so the screen-share control only appears where capture is possible.
    const canScreenShare =
      !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');

    // iOS native bridge (adj-202.5.4): the WKWebView injects a 'bridgeOpenSettings' message
    // handler so the in-page permission banner can deep-link to the OS Settings app (a web
    // page cannot open iOS Settings on its own). Absent in a plain browser.
    const settingsBridge =
      (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bridgeOpenSettings) || null;

    // A denied OS-level camera/mic permission surfaces as a getUserMedia NotAllowedError
    // (via the SDK's MediaDevicesError → cameraError/micError). Detect it so we can show
    // friendly guidance instead of a raw error string (adj-202.5.4).
    const isPermissionError = (err) => {
      if (!err) return false;
      const name = err.name || '';
      const m = (err.message || '').toLowerCase();
      return name === 'NotAllowedError' || name === 'SecurityError' ||
        m.includes('permission') || m.includes('denied') || m.includes('not allowed');
    };

    // BridgeControls (adj-202.5.1) — two-way mic + camera using the SDK's useLocalMedia
    // toggles, which flip the LIVE WebRTC tracks (setMicrophoneEnabled / setCameraEnabled)
    // WITHOUT reconnecting. (The old approach re-rendered AvatarCall with a new audio prop,
    // which is a no-op after connect — audio/video props only seed the INITIAL state.)
    //  - default mode (iOS / standalone): renders on-screen mic + camera pills.
    //  - external mode (dashboard): renders nothing; relays the chrome's bridge:mic /
    //    bridge:camera commands to the live tracks and echoes the authoritative state back.
    // Must be a child of <AvatarCall> so useLocalMedia sees the session context.
    function BridgeControls() {
      const {
        isMicEnabled, isCameraEnabled, isScreenShareEnabled,
        toggleMic, toggleCamera, toggleScreenShare,
        micError, cameraError, retryMic, retryCamera,
      } = useLocalMedia();
      // Mirror current state into refs so the message handler compares without re-subscribing.
      const micRef = React.useRef(isMicEnabled); micRef.current = isMicEnabled;
      const camRef = React.useRef(isCameraEnabled); camRef.current = isCameraEnabled;
      const shareRef = React.useRef(isScreenShareEnabled); shareRef.current = isScreenShareEnabled;

      React.useEffect(() => {
        // Honor mic/camera/screenshare COMMANDS in BOTH modes: the dashboard
        // iframe (external) AND the iOS top-level page, whose native floating-window
        // Mute posts a same-origin bridge:mic message (adj-207.2.10). toggleMic/
        // toggleCamera/toggleScreenShare exist in both modes; the same-origin check
        // below keeps it safe. Outbound echoes below stay external-only.
        const onMsg = (ev) => {
          if (ev.origin !== location.origin) return;
          const d = ev.data;
          if (!d || typeof d.type !== 'string') return;
          // Commands carry the DESIRED state; toggle only when it differs (avoids double-flip).
          if (d.type === 'bridge:mic' && typeof d.enabled === 'boolean' && d.enabled !== micRef.current) toggleMic();
          else if (d.type === 'bridge:camera' && typeof d.enabled === 'boolean' && d.enabled !== camRef.current) toggleCamera();
          else if (d.type === 'bridge:screenshare' && typeof d.enabled === 'boolean' && d.enabled !== shareRef.current) toggleScreenShare();
        };
        window.addEventListener('message', onMsg);
        return () => window.removeEventListener('message', onMsg);
      }, [toggleMic, toggleCamera, toggleScreenShare]);

      // Echo authoritative track state so the dashboard chrome toggles track reality.
      React.useEffect(() => { if (external) post({ type: 'bridge:mic', enabled: isMicEnabled }); }, [isMicEnabled]);
      React.useEffect(() => { if (external) post({ type: 'bridge:camera', enabled: isCameraEnabled }); }, [isCameraEnabled]);
      React.useEffect(() => { if (external) post({ type: 'bridge:screenshare', enabled: isScreenShareEnabled }); }, [isScreenShareEnabled]);

      const children = [];

      // Camera-live badge (adj-202.5.5) — both modes; pairs with the self-view PiP.
      if (isCameraEnabled) {
        children.push(h('div', { key: 'live', className: 'bridge-live', role: 'status' }, '🔴  Camera live'));
      }

      // Sharing indicator + one-tap Stop (adj-202.5.6) — default mode only; the dashboard
      // chrome shows its own in external mode.
      if (!external && isScreenShareEnabled) {
        children.push(h('div', { key: 'sharing', className: 'bridge-sharing', role: 'status' }, [
          h('span', { key: 'l' }, '🟣  Sharing your screen'),
          h('button', {
            key: 'stop', type: 'button', className: 'bridge-ctrl',
            'aria-label': 'Stop sharing screen', onClick: toggleScreenShare,
          }, 'Stop'),
        ]));
      }

      // Permission-blocked banner (adj-202.5.4) — friendly guidance, NOT a raw SDK error.
      // Shown in both modes (it renders inside the iframe over the avatar).
      const blockedKind = isPermissionError(cameraError) ? 'Camera' : (isPermissionError(micError) ? 'Microphone' : null);
      if (blockedKind) {
        const retry = blockedKind === 'Camera' ? retryCamera : retryMic;
        const actions = [
          h('button', { key: 'retry', type: 'button', className: 'bridge-ctrl', onClick: () => retry() }, 'Try again'),
        ];
        if (settingsBridge) {
          actions.push(h('button', {
            key: 'settings', type: 'button', className: 'bridge-ctrl',
            onClick: () => { try { settingsBridge.postMessage('open'); } catch (_) {} },
          }, 'Open Settings'));
        }
        children.push(h('div', { key: 'perm', className: 'bridge-perm', role: 'alert' }, [
          h('div', { key: 'msg' }, blockedKind + ' access is off. Enable it in Settings, then try again. Voice still works without it.'),
          h('div', { key: 'acts', className: 'bridge-perm-actions' }, actions),
        ]));
      }

      // Control pills (default mode only — the dashboard chrome owns external-mode controls).
      if (!external) {
        const buttons = [
          h('button', {
            key: 'mic', type: 'button',
            className: 'bridge-ctrl' + (isMicEnabled ? ' on' : ''),
            'aria-pressed': isMicEnabled,
            'aria-label': isMicEnabled ? 'Mute microphone' : 'Unmute microphone',
            onClick: toggleMic,
          }, (isMicEnabled ? '🎙' : '🔇') + '  ' + (isMicEnabled ? 'Mic' : 'Muted')),
          h('button', {
            key: 'cam', type: 'button',
            className: 'bridge-ctrl' + (isCameraEnabled ? ' on' : ''),
            'aria-pressed': isCameraEnabled,
            'aria-label': isCameraEnabled ? 'Turn off camera' : 'Turn on camera',
            onClick: toggleCamera,
          }, (isCameraEnabled ? '📹' : '🚫') + '  ' + (isCameraEnabled ? 'Camera' : 'No cam')),
        ];
        // Screen-share only where the surface picker exists (not iOS WKWebView).
        if (canScreenShare) {
          buttons.push(h('button', {
            key: 'share', type: 'button',
            className: 'bridge-ctrl' + (isScreenShareEnabled ? ' on' : ''),
            'aria-pressed': isScreenShareEnabled,
            'aria-label': isScreenShareEnabled ? 'Stop sharing screen' : 'Share screen',
            title: 'Pick a tab, window, or screen to share into the Bridge',
            onClick: toggleScreenShare,
          }, '🖥  ' + (isScreenShareEnabled ? 'Sharing' : 'Share')));
        }
        children.push(h('div', { key: 'controls', className: 'bridge-controls' }, buttons));
      }

      return children.length ? h(React.Fragment, null, children) : null;
    }

    let current = null;
    let retriedConsume = false; // adj-202.10.1: allow exactly ONE auto-reconnect.
    const render = () => {
      if (!current) return;
      root.render(h(AvatarCall, {
        avatarId: current.avatarId,
        sessionId: current.sessionId,
        sessionKey: current.sessionKey,
        // Seed: mic ON, camera OFF. Both are then toggled LIVE via useLocalMedia (no reconnect).
        audio: true,
        video: false,
        onError: (e) => {
          const msg = e && e.message ? e.message : String(e);
          // adj-202.10.1: a (now-defended) stale session can still fail to consume
          // ("Cannot consume session in status: FAILED. Session must be READY."). Rather than
          // make the Commander tap twice, auto-retry ONCE with a fresh on-demand session before
          // surfacing the error. Default mode only — external mode's session is owned by the
          // parent, so re-fetching would mint a second (double-billed) session.
          if (!external && !retriedConsume && /consume|must be ready|cannot consume|status:\\s*failed/i.test(msg)) {
            retriedConsume = true;
            statusEl.style.display = 'block';
            setStatus('<span class="spin"></span>Reconnecting to the Adjutant…', false);
            fetchSession().then(start).catch((err) => {
              const m = err && err.message ? err.message : String(err);
              statusEl.style.display = 'block'; setStatus('Error: ' + m, true);
            });
            return;
          }
          if (external) post({ type: 'bridge:status', status: 'error', detail: msg });
          statusEl.style.display = 'block'; setStatus('Error: ' + msg, true);
        },
        onEnd: () => { if (external) post({ type: 'bridge:status', status: 'ended' }); },
      }, [
        h(AvatarVideo, { key: 'avatar' }),
        h(UserVideo, { key: 'self' }),
        // Local preview of the shared surface (adj-202.5.2); renders null unless sharing.
        h(ScreenShareVideo, { key: 'share' }),
        h(BridgeControls, { key: 'controls' }),
      ]));
    };
    const start = (session) => {
      current = session;
      setStatus(''); statusEl.style.display = 'none';
      if (external) post({ type: 'bridge:status', status: 'connecting' });
      render();
      if (external) post({ type: 'bridge:status', status: 'connected' });
    };

    if (external) {
      let started = false;
      window.addEventListener('message', (ev) => {
        if (ev.origin !== location.origin) return;
        const d = ev.data;
        if (!d || typeof d.type !== 'string') return;
        if (d.type === 'bridge:session' && !started && d.sessionId && d.sessionKey) {
          started = true;
          start({ sessionId: d.sessionId, sessionKey: d.sessionKey, avatarId: d.avatarId });
        }
        // bridge:mic / bridge:camera commands are handled inside BridgeControls (live tracks).
      });
      post({ type: 'bridge:ready' }); // tell the panel we're loaded and awaiting creds
      // NOTE: captions (bridge:caption) are intentionally not emitted — the
      // @runwayml/avatars-react SDK does not expose a transcript stream (adj-202.3.7.1 deferred).
    } else {
      // Session was kicked off in parallel at the top — await its result now (often already done).
      start(await sessionPromise);
    }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (external) post({ type: 'bridge:status', status: 'error', detail: msg });
    setStatus('Could not connect to the Adjutant: ' + msg, true);
  }
</script>
</body>
</html>
`;
