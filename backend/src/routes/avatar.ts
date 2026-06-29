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

import type { BridgeSessionBroker, StartSessionOptions, BridgeSessionCreds } from "../services/bridge-session-broker.js";
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

  const buildOpts = (customAvatarId?: string): StartSessionOptions => {
    // Tool-enable exactly like POST /api/bridge/session: read-only fleet tools + a persona that
    // tells GWM-1 to CALL them. Default mode has no selected project (fleet tools need none).
    const opts: StartSessionOptions = { tools: BRIDGE_RPC_TOOLS, personality: composeBridgePersonality() };
    if (customAvatarId !== undefined) opts.avatarId = customAvatarId;
    return opts;
  };

  // Create a fully-ready session: broker create+poll, then attach the tool-loop handler.
  async function createReadySession(customAvatarId?: string): Promise<BridgeSessionCreds> {
    const session = await deps.broker.startSession(buildOpts(customAvatarId));
    // `attach` swallows its own errors — a tool-loop hiccup must not fail a billable session.
    if (deps.rpcManager) await deps.rpcManager.attach({ sessionId: session.sessionId });
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

  // Take the warm session if it is still fresh; otherwise drop any stale one and return null.
  function takeWarm(): BridgeSessionCreds | null {
    if (warmFresh() && warm) {
      const creds = warm.creds;
      warm = null;
      return creds;
    }
    warm = null;
    return null;
  }

  // POST /avatar/prepare — warm a session ahead of a tap (called by iOS on foreground/intent).
  // Idempotent, cost-guarded, returns immediately without blocking on provisioning.
  router.post("/prepare", (_req, res) => {
    triggerWarm();
    return res.json({ ok: true, warm: warmFresh() });
  });

  router.post("/connect", async (req, res) => {
    const body = req.body as { customAvatarId?: unknown } | undefined;
    const customAvatarId =
      typeof body?.customAvatarId === "string" && body.customAvatarId.length > 0 ? body.customAvatarId : undefined;

    try {
      // Fast path: hand out the pre-warmed session (default avatar only — a custom avatar can't
      // reuse the warm one). This is the ~2s path.
      if (customAvatarId === undefined) {
        const warmCreds = takeWarm();
        if (warmCreds) {
          logInfo("avatar session served warm", { sessionId: warmCreds.sessionId });
          return res.json(warmCreds);
        }
      }

      // On-demand path (no warm session available).
      const session = await createReadySession(customAvatarId);
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
    pointer-events: auto; display: inline-flex; align-items: center; gap: 6px;
    padding: 10px 16px; border-radius: 999px;
    border: 1px solid rgba(255,136,0,.7); background: rgba(8,4,16,.62) !important;
    color: #ffab4d; font-family: inherit; font-size: 13px; letter-spacing: .04em;
    cursor: pointer; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  }
  .bridge-ctrl.on { border-color: rgba(31,182,214,.75); color: #7fe8ff; }
  .bridge-ctrl:focus-visible { outline: 2px solid #7fe8ff; outline-offset: 2px; }

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
  // PERF (adj-202): start the session create IMMEDIATELY (default mode) so Runway provisions the
  // avatar WHILE the SDK downloads — the two slowest steps now overlap instead of running back to
  // back. External mode receives its creds from the parent, so it does not self-fetch.
  const sessionPromise = external
    ? null
    : fetch('/avatar/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(async (res) => {
          if (!res.ok) { const t = await res.text(); throw new Error('Session failed (' + res.status + '): ' + t); }
          return res.json();
        });
  if (sessionPromise) sessionPromise.catch(() => {}); // pre-handle: avoid unhandled rejection if imports fail first
  try {
    // Load the SDK modules SERIALLY — the proven order (react first so react-dom and
    // avatars-react resolve it from cache). Parallel Promise.all imports + modulepreload tripped
    // a WKWebView "Importing a module script failed". The session fetch above already overlaps
    // the slowest part, so the imports don't need to be parallelized.
    const React = (await import('https://esm.sh/react@18')).default;
    const { createRoot } = await import('https://esm.sh/react-dom@18/client');
    const { AvatarCall, AvatarVideo, UserVideo, ScreenShareVideo, useLocalMedia } =
      await import('https://esm.sh/@runwayml/avatars-react?deps=react@18,react-dom@18');
    const h = React.createElement;
    const root = createRoot(document.getElementById('root'));

    // Screen-share (adj-202.5.2) needs getDisplayMedia, which iOS Safari / WKWebView do
    // NOT implement — so the screen-share control only appears where capture is possible.
    const canScreenShare =
      !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');

    // BridgeControls (adj-202.5.1) — two-way mic + camera using the SDK's useLocalMedia
    // toggles, which flip the LIVE WebRTC tracks (setMicrophoneEnabled / setCameraEnabled)
    // WITHOUT reconnecting. (The old approach re-rendered AvatarCall with a new audio prop,
    // which is a no-op after connect — audio/video props only seed the INITIAL state.)
    //  - default mode (iOS / standalone): renders on-screen mic + camera pills.
    //  - external mode (dashboard): renders nothing; relays the chrome's bridge:mic /
    //    bridge:camera commands to the live tracks and echoes the authoritative state back.
    // Must be a child of <AvatarCall> so useLocalMedia sees the session context.
    function BridgeControls() {
      const { isMicEnabled, isCameraEnabled, isScreenShareEnabled, toggleMic, toggleCamera, toggleScreenShare } =
        useLocalMedia();
      // Mirror current state into refs so the message handler compares without re-subscribing.
      const micRef = React.useRef(isMicEnabled); micRef.current = isMicEnabled;
      const camRef = React.useRef(isCameraEnabled); camRef.current = isCameraEnabled;
      const shareRef = React.useRef(isScreenShareEnabled); shareRef.current = isScreenShareEnabled;

      React.useEffect(() => {
        if (!external) return;
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

      if (external) return null; // the dashboard chrome owns the visible controls

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
          onClick: toggleScreenShare,
        }, '🖥  ' + (isScreenShareEnabled ? 'Sharing' : 'Share')));
      }
      return h('div', { className: 'bridge-controls' }, buttons);
    }

    let current = null;
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
