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
    // Bind IPv4 only. BROWSE TO http://127.0.0.1:4200 — `localhost:4200` is NOT
    // equivalent on this machine (adj-9tqx4).
    //
    // Native IPv6 loopback to this port is broken here, below the application:
    // connections to [::1]:4200 stall to the client timeout (17/20 measured)
    // while IPv4 on the SAME dual-stack socket is 0/20 slow and the dev server
    // logs 200s for both. Verified it is not ours to fix — one correct `tcp46
    // *.4200` listener, net.inet6.ip6.v6only=0, no second binder, macOS
    // Application Firewall disabled, and the stalls persist with ngrok stopped.
    // The SYNs are simply never answered. Tracked in adj-8u5vq.
    //
    // Given that, serving IPv6 is strictly worse than not serving it: a browser
    // that picks ::1 hangs for 30s instead of failing over. Binding IPv4 removes
    // that path, and addressing the server as a literal 127.0.0.1 removes the
    // name resolution that would send a browser there in the first place —
    // which matters because Safari, unlike Chrome, does not fall back to IPv4
    // when ::1 fails. 0.0.0.0 rather than 127.0.0.1 keeps ngrok + LAN working.
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
