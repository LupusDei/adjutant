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
    // Listen dual-stack so plain `localhost:4200` works in every browser.
    //
    // Do NOT narrow this to one family. An IPv4-only listener leaves nothing on
    // ::1, and Safari does not fall back to 127.0.0.1 the way Chrome does — it
    // fails outright with "Safari Can't Connect to the Server" and every fetch
    // then reports "due to access control checks".
    //
    // The 30s stalls that made IPv6 look guilty were NOT the listener. Measured
    // on a warm dual-stack server: [::1] is 20/20 fast for the page, 20/20 for
    // proxied /api, and the /ws upgrade returns 101. The earlier "IPv6 hangs"
    // reading was taken against a Vite that had just restarted and was still
    // dependency-optimizing — a cold-start artifact, not an address-family one.
    //
    // What actually had to change is the proxy hop below: targets are explicit
    // 127.0.0.1 literals (not "localhost"), so requests leaving this dev server
    // never reach the backend over IPv6.
    host: true,
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
