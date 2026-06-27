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
  html, body { margin: 0; height: 100%; background: #0b0710; color: #e7d9ee; font-family: -apple-system, system-ui, sans-serif; }
  #root { position: fixed; inset: 0; }
  #status { position: fixed; left: 0; right: 0; bottom: 0; padding: 12px 16px env(safe-area-inset-bottom); text-align: center; font-size: 14px; color: #c9a0e0; }
  #status.err { color: #ff8e8e; }
  .spin { display:inline-block; width:14px;height:14px;border:2px solid #a118c4;border-top-color:transparent;border-radius:50%;animation:s .8s linear infinite;vertical-align:-2px;margin-right:8px;}
  @keyframes s { to { transform: rotate(360deg);} }
</style>
</head>
<body>
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
      onError: (e) => { statusEl.style.display = 'block'; setStatus('Error: ' + (e && e.message ? e.message : e), true); },
    }));
  } catch (e) {
    setStatus('Could not connect to the Adjutant: ' + (e && e.message ? e.message : e), true);
  }
</script>
</body>
</html>
`;
