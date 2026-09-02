// @vitest-environment node
//
// The config pulls in Vite's plugins, and esbuild refuses to load under jsdom
// (its `new TextEncoder().encode("") instanceof Uint8Array` invariant fails
// against jsdom's globals). This test asserts on a config object, not the DOM.
/**
 * adj-z9dqs regression: Vite must NEVER fall back to another port.
 *
 * Vite's default behaviour when its port is taken is to walk upward — and the
 * next port up from the frontend's 4200 is the BACKEND's 4201. On 2026-09-02 a
 * duplicate dev stack did exactly that, bound :4201 on IPv6, and shadowed the
 * backend for every client that resolves `localhost` to ::1: ENDPOINT_NOT_FOUND
 * fleet-wide, 0 live agents, while 127.0.0.1:4201/health stayed green.
 *
 * strictPort turns that silent, fleet-wide failure into a loud local one. It
 * lives in the CONFIG (not only in the launchd wrapper's --strictPort flag) so
 * it holds for every launch path: npm run dev, dev:local, scripts/dev.sh, and a
 * bare `vite` typed by an agent.
 */
import { describe, expect, it } from "vitest";

import viteConfig from "../../vite.config";

// defineConfig accepts an object or a factory; ours is a plain object.
const config = viteConfig as { server?: { port?: number; strictPort?: boolean }; preview?: { strictPort?: boolean } };

describe("vite.config strict port", () => {
  it("should set strictPort on the dev server so a taken port fails instead of shifting", () => {
    expect(config.server?.strictPort).toBe(true);
  });

  it("should set strictPort on the preview server too", () => {
    expect(config.preview?.strictPort).toBe(true);
  });

  it("should keep the dev port adjacent to the backend port, which is why the fallback was dangerous", () => {
    // Documents the hazard the flag guards: 4200 + 1 === 4201 (the backend).
    expect(config.server?.port).toBe(4200);
  });
});
