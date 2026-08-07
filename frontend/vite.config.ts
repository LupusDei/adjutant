/// <reference types="vitest" />
import { Agent } from "node:http";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Port configuration with environment variable overrides
const FRONTEND_PORT = parseInt(process.env["VITE_PORT"] ?? "4200", 10);
const API_PORT = process.env["VITE_API_PORT"] ?? "4201";

// Proxy to the backend over IPv4 explicitly, never the literal "localhost"
// (adj-plck0). Node 24 resolves "localhost" with Happy Eyeballs and may pick
// ::1, which lands on the intermittently-hanging IPv6 loopback path and stalls
// the proxied request (and the /ws upgrade) until the client's 30s timeout.
const API_TARGET = `http://127.0.0.1:${API_PORT}`;

// Reuse proxy connections to the backend (adj-xbu7s root cause).
//
// http-proxy's default agent opens a BRAND-NEW TCP connection for every proxied
// request and the backend closes it after the response, leaving a TIME_WAIT
// entry that lingers for 2*MSL (30s on macOS). Under dashboard polling load
// that reached ~10,000 TIME_WAIT sockets on the backend port and ~35,000
// machine-wide — enough to exhaust the loopback ephemeral-port space, at which
// point NEW connections to ANY local port (Vite, the backend, static files,
// ngrok's upstream) randomly blackholed. That was the all-day "intermittent
// 30s timeout / frontend won't load" — a machine-level connection flood, not
// any single route.
//
// A keep-alive agent holds a small pool of persistent connections instead:
// thousands of proxied requests reuse ~a dozen sockets and the churn stops.
const keepAliveAgent = new Agent({ keepAlive: true, maxSockets: 64, keepAliveMsecs: 30_000 });

// Suppress noisy ECONNREFUSED proxy errors during startup (adj-084 Bug 1).
// The frontend starts before the backend is ready; these errors are transient
// and the browser retries automatically.
const suppressProxyError = (
  err: Error,
  _req: unknown,
  res: { writeHead?: (status: number, headers: Record<string, string>) => void; end?: (body: string) => void },
) => {
  if (res.writeHead && res.end) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Backend not ready yet" }));
  }
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: FRONTEND_PORT,
    // Listen dual-stack so `localhost:4200` works in every browser (adj-e4rkt).
    //
    // Do NOT narrow this to one family. Safari does not fall back to 127.0.0.1
    // when nothing answers on ::1 — an IPv4-only listener makes localhost:4200
    // fail outright there, and it fails BEFORE reaching the server, so no
    // server-side redirect can rescue it.
    //
    // IPv6 loopback here is healthy. Measured warm on this port, dual-stack:
    // [::1] page 0/25 slow, [::1] /api 0/20 slow, HMR ws over [::1] 101. Every
    // earlier reading that condemned IPv6 was taken against a server that had
    // just restarted and was still dependency-optimizing (a cold request
    // measured 90s, then 3ms warm) — a cold-start artifact, not IPv6.
    //
    // The proxy targets below stay explicit 127.0.0.1 literals so the hop to
    // the backend never depends on name resolution.
    host: true,
    // Allow ngrok and other tunneling services
    allowedHosts: true,
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
        agent: keepAliveAgent,
        configure: (proxy) => {
          proxy.on("error", suppressProxyError);
        },
      },
      "/ws": {
        target: API_TARGET,
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on("error", suppressProxyError);
        },
      },
      // Public proposal share pages (adj-200) are served by the backend at /p/:token.
      // Proxy them so no-API-key share links work through the dev tunnel, matching
      // the single-origin production deploy where the backend serves both.
      "/p": {
        target: API_TARGET,
        changeOrigin: true,
        agent: keepAliveAgent,
        configure: (proxy) => {
          proxy.on("error", suppressProxyError);
        },
      },
      // The Bridge avatar prototype (adj-202.2) is served by the backend at /avatar
      // (page) + /avatar/connect (session). Proxy it so the iOS WKWebView overlay,
      // which loads <tunnel>/avatar through the frontend origin, reaches the backend
      // instead of falling through to the SPA (which served the dashboard — adj-202 bug).
      "/avatar": {
        target: API_TARGET,
        changeOrigin: true,
        agent: keepAliveAgent,
        configure: (proxy) => {
          proxy.on("error", suppressProxyError);
        },
      },
      "/ngrok-api": {
        target: "http://127.0.0.1:4040",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ngrok-api/, ""),
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
  },
});
