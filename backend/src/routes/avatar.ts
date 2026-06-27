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

import { Router } from "express";

import type { BridgeSessionBroker, StartSessionOptions } from "../services/bridge-session-broker.js";
import { BridgeCostCeilingError } from "../services/bridge-session-broker.js";
import type { BridgeRpcManager } from "../services/bridge-rpc-handler.js";
import { BRIDGE_RPC_TOOLS, composeBridgePersonality } from "../services/bridge-rpc-tools.js";
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
}

export function createAvatarRouter(deps: AvatarRouterDeps): Router {
  const router = Router();

  router.post("/connect", async (req, res) => {
    const body = req.body as { customAvatarId?: unknown } | undefined;
    const customAvatarId =
      typeof body?.customAvatarId === "string" && body.customAvatarId.length > 0 ? body.customAvatarId : undefined;

    // Tool-enable the session exactly like POST /api/bridge/session: the avatar gets
    // the read-only fleet tools + a persona that tells GWM-1 to CALL them. Default
    // mode has no selected project — fleet tools (list_agents/list_questions) need none.
    const opts: StartSessionOptions = {
      tools: BRIDGE_RPC_TOOLS,
      personality: composeBridgePersonality(),
    };
    if (customAvatarId !== undefined) opts.avatarId = customAvatarId;

    try {
      const session = await deps.broker.startSession(opts);

      // Attach the server-side tool loop so the avatar can actually query the fleet.
      // `attach` swallows its own errors — a tool-loop hiccup must not fail a live,
      // billable session — so awaiting it is safe.
      if (deps.rpcManager) {
        await deps.rpcManager.attach({ sessionId: session.sessionId });
      }

      logInfo("avatar session created", { sessionId: session.sessionId, avatarId: session.avatarId });
      // Preserve the EXACT contract the /avatar page consumes.
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
  /* The widget is now full-screen (position:relative). Absolutely fill the video to it,
     cover-cropped → centered full-screen portrait. Absolute (not fixed) so the widget's
     ::before filter:blur() doesn't trap it; the widget itself is the positioned ancestor. */
  [data-avatar-video], [data-avatar-video] > * { position: absolute !important; inset: 0 !important; height: 100% !important; width: 100% !important; }
  [data-avatar-call] video, [data-avatar-call] canvas, #root video, #root canvas {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
  }
  /* Keep the call controls above the full-bleed video */
  [data-avatar-control-bar] { z-index: 2 !important; }

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
  try {
    const React = (await import('https://esm.sh/react@18')).default;
    const { createRoot } = await import('https://esm.sh/react-dom@18/client');
    const { AvatarCall } = await import('https://esm.sh/@runwayml/avatars-react?deps=react@18,react-dom@18');
    const root = createRoot(document.getElementById('root'));

    let micEnabled = true;
    let current = null;
    const render = () => {
      if (!current) return;
      root.render(React.createElement(AvatarCall, {
        avatarId: current.avatarId,
        sessionId: current.sessionId,
        sessionKey: current.sessionKey,
        // Voice conversation: keep the mic, disable the front camera (no self-view PiP).
        audio: micEnabled,
        video: false,
        onError: (e) => {
          const msg = e && e.message ? e.message : String(e);
          if (external) post({ type: 'bridge:status', status: 'error', detail: msg });
          statusEl.style.display = 'block'; setStatus('Error: ' + msg, true);
        },
        onEnd: () => { if (external) post({ type: 'bridge:status', status: 'ended' }); },
      }));
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
        } else if (d.type === 'bridge:mic' && typeof d.enabled === 'boolean') {
          micEnabled = d.enabled;
          render();
          post({ type: 'bridge:mic', enabled: micEnabled }); // echo confirmed state
        }
      });
      post({ type: 'bridge:ready' }); // tell the panel we're loaded and awaiting creds
      // NOTE: captions (bridge:caption) are intentionally not emitted — the
      // @runwayml/avatars-react SDK does not expose a transcript stream (adj-202.3.7.1 deferred).
    } else {
      const res = await fetch('/avatar/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) { const t = await res.text(); throw new Error('Session failed (' + res.status + '): ' + t); }
      start(await res.json());
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
