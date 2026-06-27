/**
 * The Bridge — avatar prototype routes (adj-202.2.1 / adj-202.2.4).
 *
 * Two public, no-API-key endpoints (mounted BEFORE apiKeyAuth, like /p):
 *   POST /avatar/connect  -> server-side Runway session create+poll, returns { sessionId, sessionKey, avatarId }
 *   GET  /avatar          -> a self-contained web client (loads @runwayml/avatars-react from a CDN,
 *                            fetches /avatar/connect, renders <AvatarCall>). Loaded by the iOS WKWebView overlay.
 *
 * The secret RUNWAYML_API_SECRET stays server-side; the browser only ever sees the short-lived
 * sessionKey. PROTOTYPE: not wired to the coordinator/MCP tools yet — this just talks to the character.
 *
 * NOTE: these are intentionally unauthenticated for the prototype so the WKWebView page can call
 * /connect same-origin without injecting the dashboard API key. Each connect burns ~2 Runway credits;
 * tighten before any non-prototype use.
 */

import { Router } from "express";
import { createReadyAvatarSession } from "../services/runway-avatar.js";
import { logError, logInfo } from "../utils/logger.js";

export function createAvatarRouter(): Router {
  const router = Router();

  router.post("/connect", async (req, res) => {
    const body = req.body as { customAvatarId?: unknown } | undefined;
    const customAvatarId =
      typeof body?.customAvatarId === "string" && body.customAvatarId.length > 0 ? body.customAvatarId : undefined;
    try {
      const session = await createReadyAvatarSession(customAvatarId ? { avatarId: customAvatarId } : {});
      logInfo("avatar session created", { sessionId: session.sessionId, avatarId: session.avatarId });
      res.json(session);
    } catch (err) {
      logError("avatar session create failed", { error: err instanceof Error ? err.message : String(err) });
      res.status(502).json({
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

  /* Avatar layer — centered in the middle, transparent so the galaxy shows behind it */
  #root { position: fixed; inset: 0; z-index: 1; display: flex; align-items: center; justify-content: center; }
  #root, #root * { background-color: transparent !important; }
  #root > * { max-width: 96vw !important; max-height: 84vh !important; }
  #root video, #root canvas {
    display: block; margin: auto; width: auto; height: auto;
    max-width: 96vw; max-height: 84vh;
    border-radius: 22px;
    box-shadow: 0 0 70px rgba(161,24,196,.40), 0 0 150px rgba(31,182,214,.18);
  }

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
  try {
    const React = (await import('https://esm.sh/react@18')).default;
    const { createRoot } = await import('https://esm.sh/react-dom@18/client');
    const { AvatarCall } = await import('https://esm.sh/@runwayml/avatars-react?deps=react@18,react-dom@18');

    const res = await fetch('/avatar/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!res.ok) { const t = await res.text(); throw new Error('Session failed (' + res.status + '): ' + t); }
    const session = await res.json();

    setStatus('');
    statusEl.style.display = 'none';
    const root = createRoot(document.getElementById('root'));
    root.render(React.createElement(AvatarCall, {
      avatarId: session.avatarId,
      sessionId: session.sessionId,
      sessionKey: session.sessionKey,
      // Voice conversation: keep the mic, disable the user's front camera so there's
      // no self-view picture-in-picture (and no camera permission prompt).
      audio: true,
      video: false,
      onError: (e) => { statusEl.style.display = 'block'; setStatus('Error: ' + (e && e.message ? e.message : e), true); },
    }));
  } catch (e) {
    setStatus('Could not connect to the Adjutant: ' + (e && e.message ? e.message : e), true);
  }
</script>
</body>
</html>
`;
