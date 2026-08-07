/// <reference types="vitest" />
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
    // Bind IPv4 only — deliberately NOT `true`/dual-stack (adj-plck0, refines adj-hwzcw).
    //
    // `localhost` on macOS resolves to BOTH ::1 and 127.0.0.1, and the client
    // picks per-connection. Connections to this stack over ::1 hang ~30% of the
    // time (measured: interleaved same-instant requests to the backend were
    // 14/14 fast on IPv4 and 4/14 hung on ::1; a bare node server is clean on
    // both, so it is our stack, not the OS).
    //
    // adj-hwzcw used `host: true`, which made Vite ACCEPT the ::1 connection and
    // then stall — trading a fast ECONNREFUSED for a 30s hang. That is the
    // "COMM ERROR: REQUEST TIMED OUT AFTER 30000MS" on AGENTS/CHAT, and the
    // "WebSocket is closed before the connection is established" for /ws/chat.
    //
    // Binding IPv4-only restores fail-fast: a browser that tries ::1 is refused
    // instantly and falls back to 127.0.0.1 on the spot. 0.0.0.0 (not 127.0.0.1)
    // keeps LAN/tunnel access working.
    host: "0.0.0.0",
    // Allow ngrok and other tunneling services
    allowedHosts: true,
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
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
