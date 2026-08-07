/**
 * @vitest-environment node
 *
 * Runs in node, not jsdom: importing vite.config pulls in esbuild, which
 * refuses to load under jsdom ("new TextEncoder().encode('') instanceof
 * Uint8Array is incorrectly false").
 *
 * Regression tests for adj-plck0 (refines adj-hwzcw).
 *
 * `localhost` on macOS resolves to BOTH ::1 and 127.0.0.1 and the client picks
 * per-connection. Connections to this stack over ::1 stall ~30% of the time
 * (measured: interleaved same-instant probes to the backend were 14/14 fast on
 * 127.0.0.1 and 4/14 hung on [::1]; a bare node server is clean on both, so the
 * fault is ours, not the OS).
 *
 * adj-hwzcw set `host: true`, which made Vite *accept* the ::1 connection and
 * then hang — trading a fast ECONNREFUSED for a 30s stall. That surfaced as
 * "COMM ERROR: REQUEST TIMED OUT AFTER 30000MS" on AGENTS/CHAT and
 * "WebSocket is closed before the connection is established" for /ws/chat.
 *
 * The contract these tests pin: every loopback hop is IPv4-explicit, so a
 * client that tries ::1 fails fast and retries on IPv4 instead of hanging.
 */

import { describe, it, expect } from "vitest";

import viteConfig from "../../vite.config";

interface ProxyEntry {
  target?: unknown;
  ws?: boolean;
}

/** The resolved config object (defineConfig returns what it was given here). */
const config = viteConfig as unknown as {
  server?: {
    host?: unknown;
    proxy?: Record<string, ProxyEntry>;
  };
};

describe("vite dev server binding (adj-9tqx4)", () => {
  it("should bind IPv4 only — native IPv6 loopback to this port is broken here", () => {
    // [::1]:4200 stalls to the client timeout (17/20) while IPv4 on the same
    // dual-stack socket is 0/20 slow. Serving IPv6 means a browser that picks
    // ::1 hangs 30s instead of failing over, so don't serve it.
    expect(config.server?.host).toBe("0.0.0.0");
  });

  it("should not narrow to loopback-only, so ngrok and LAN still reach it", () => {
    const host = config.server?.host;

    // 127.0.0.1 would also dodge IPv6 but breaks tunnel/LAN reachability.
    expect(host).not.toBe("127.0.0.1");
    expect(host).not.toBe("::1");
    expect(host).not.toBe(true);
  });
});

describe("vite proxy targets (adj-plck0)", () => {
  const proxy = config.server?.proxy ?? {};
  const entries = Object.entries(proxy);

  it("should define proxies for the backend-served paths", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const path of ["/api", "/ws", "/p", "/avatar"]) {
      expect(Object.keys(proxy)).toContain(path);
    }
  });

  it.each(entries.map(([path, entry]) => [path, entry] as const))(
    "should point %s at an explicit IPv4 host, not 'localhost'",
    (_path, entry) => {
      const target = String(entry.target);

      // "localhost" here lets Node 24 Happy-Eyeball onto ::1 and stall the
      // proxied request until the client's 30s timeout.
      expect(target).not.toContain("localhost");
      expect(target).not.toContain("[::1]");
      expect(target).toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
    },
  );

  it("should proxy the websocket path with ws enabled over IPv4", () => {
    // The /ws upgrade is what CommunicationContext + useChatWebSocket ride; if
    // it lands on the hanging path the browser reports "closed before the
    // connection is established" and AGENTS/CHAT never populate.
    const ws = proxy["/ws"];
    expect(ws?.ws).toBe(true);
    expect(String(ws?.target)).toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
  });
});
