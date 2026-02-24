import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";
import type { DeviceTokenService } from "../../src/services/device-token-service.js";

let testDir: string;
let db: Database.Database;
let service: DeviceTokenService;

function freshTestDir(): string {
  const dir = join(
    tmpdir(),
    `adjutant-devtoken-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupDb(): Promise<Database.Database> {
  const { createDatabase, runMigrations } = await import(
    "../../src/services/database.js"
  );
  const instance = createDatabase(join(testDir, "test.db"));
  runMigrations(instance);
  return instance;
}

describe("device-token-service", () => {
  beforeEach(async () => {
    testDir = freshTestDir();
    db = await setupDb();
    const { createDeviceTokenService } = await import(
      "../../src/services/device-token-service.js"
    );
    service = createDeviceTokenService(db);
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("registerDeviceToken", () => {
    it("should register a new device token", () => {
      const result = service.registerDeviceToken({
        token: "aabbccdd11223344",
        platform: "ios",
        bundleId: "com.test.app",
      });

      expect(result.success).toBe(true);
      expect(result.data?.isNew).toBe(true);
      expect(result.data?.token.token).toBe("aabbccdd11223344");
      expect(result.data?.token.platform).toBe("ios");
      expect(result.data?.token.bundleId).toBe("com.test.app");
      expect(result.data?.token.registeredAt).toBeTruthy();
      expect(result.data?.token.lastSeenAt).toBeTruthy();
    });

    it("should update an existing device token", () => {
      service.registerDeviceToken({
        token: "aabbccdd11223344",
        platform: "ios",
        bundleId: "com.test.app",
      });

      const result = service.registerDeviceToken({
        token: "aabbccdd11223344",
        platform: "macos",
        bundleId: "com.test.app2",
      });

      expect(result.success).toBe(true);
      expect(result.data?.isNew).toBe(false);
      expect(result.data?.token.platform).toBe("macos");
      expect(result.data?.token.bundleId).toBe("com.test.app2");
    });

    it("should preserve registeredAt on update", () => {
      const first = service.registerDeviceToken({
        token: "aabbccdd11223344",
        platform: "ios",
        bundleId: "com.test.app",
      });
      const originalRegisteredAt = first.data?.token.registeredAt;

      const second = service.registerDeviceToken({
        token: "aabbccdd11223344",
        platform: "ios",
        bundleId: "com.test.app",
      });

      expect(second.data?.token.registeredAt).toBe(originalRegisteredAt);
    });

    it("should reject invalid hex token", () => {
      const result = service.registerDeviceToken({
        token: "not-hex-zzzz",
        platform: "ios",
        bundleId: "com.test.app",
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_TOKEN_FORMAT");
    });

    it("should store optional agentId", () => {
      const result = service.registerDeviceToken({
        token: "aabbccdd11223344",
        platform: "ios",
        agentId: "agent-007",
        bundleId: "com.test.app",
      });

      expect(result.success).toBe(true);
      expect(result.data?.token.agentId).toBe("agent-007");
    });

    it("should leave agentId undefined when not provided", () => {
      const result = service.registerDeviceToken({
        token: "aabbccdd11223344",
        platform: "ios",
        bundleId: "com.test.app",
      });

      expect(result.success).toBe(true);
      expect(result.data?.token.agentId).toBeUndefined();
    });
  });

  describe("unregisterDeviceToken", () => {
    it("should remove an existing token", () => {
      service.registerDeviceToken({
        token: "aabbccdd11223344",
        platform: "ios",
        bundleId: "com.test.app",
      });

      const result = service.unregisterDeviceToken("aabbccdd11223344");
      expect(result.success).toBe(true);

      // Verify it's gone
      const all = service.getAllDeviceTokens();
      expect(all.data).toHaveLength(0);
    });

    it("should return error for non-existent token", () => {
      const result = service.unregisterDeviceToken("does_not_exist");
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TOKEN_NOT_FOUND");
    });
  });

  describe("getAllDeviceTokens", () => {
    it("should return empty array when no tokens registered", () => {
      const result = service.getAllDeviceTokens();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });

    it("should return all registered tokens", () => {
      service.registerDeviceToken({
        token: "aaaa1111",
        platform: "ios",
        bundleId: "com.test.app",
      });
      service.registerDeviceToken({
        token: "bbbb2222",
        platform: "macos",
        bundleId: "com.test.app",
      });

      const result = service.getAllDeviceTokens();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });
  });

  describe("getDeviceTokensByPlatform", () => {
    it("should filter tokens by platform", () => {
      service.registerDeviceToken({
        token: "aaaa1111",
        platform: "ios",
        bundleId: "com.test.app",
      });
      service.registerDeviceToken({
        token: "bbbb2222",
        platform: "macos",
        bundleId: "com.test.app",
      });
      service.registerDeviceToken({
        token: "cccc3333",
        platform: "ios",
        bundleId: "com.test.app",
      });

      const result = service.getDeviceTokensByPlatform("ios");
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.every((t) => t.platform === "ios")).toBe(true);
    });

    it("should return empty array for platform with no tokens", () => {
      service.registerDeviceToken({
        token: "aaaa1111",
        platform: "ios",
        bundleId: "com.test.app",
      });

      const result = service.getDeviceTokensByPlatform("macos");
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });
  });

  describe("getDeviceTokensByAgent", () => {
    it("should filter tokens by agentId", () => {
      service.registerDeviceToken({
        token: "aaaa1111",
        platform: "ios",
        agentId: "agent-A",
        bundleId: "com.test.app",
      });
      service.registerDeviceToken({
        token: "bbbb2222",
        platform: "ios",
        agentId: "agent-B",
        bundleId: "com.test.app",
      });
      service.registerDeviceToken({
        token: "cccc3333",
        platform: "macos",
        agentId: "agent-A",
        bundleId: "com.test.app",
      });

      const result = service.getDeviceTokensByAgent("agent-A");
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.every((t) => t.agentId === "agent-A")).toBe(true);
    });

    it("should return empty array when no tokens match agent", () => {
      service.registerDeviceToken({
        token: "aaaa1111",
        platform: "ios",
        agentId: "agent-A",
        bundleId: "com.test.app",
      });

      const result = service.getDeviceTokensByAgent("agent-Z");
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });
  });

  describe("cleanupStaleTokens", () => {
    it("should remove tokens older than maxAgeDays", () => {
      // Register a token
      service.registerDeviceToken({
        token: "aaaa1111",
        platform: "ios",
        bundleId: "com.test.app",
      });

      // Manually backdate its last_seen_at to 60 days ago
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 60);
      db.prepare("UPDATE device_tokens SET last_seen_at = ? WHERE token = ?").run(
        cutoff.toISOString(),
        "aaaa1111"
      );

      // Register a recent token
      service.registerDeviceToken({
        token: "bbbb2222",
        platform: "ios",
        bundleId: "com.test.app",
      });

      const result = service.cleanupStaleTokens(30);
      expect(result.success).toBe(true);
      expect(result.data?.removed).toBe(1);

      // Only the recent token should remain
      const all = service.getAllDeviceTokens();
      expect(all.data).toHaveLength(1);
      expect(all.data?.[0]?.token).toBe("bbbb2222");
    });

    it("should keep recent tokens untouched", () => {
      service.registerDeviceToken({
        token: "aaaa1111",
        platform: "ios",
        bundleId: "com.test.app",
      });
      service.registerDeviceToken({
        token: "bbbb2222",
        platform: "macos",
        bundleId: "com.test.app",
      });

      const result = service.cleanupStaleTokens(30);
      expect(result.success).toBe(true);
      expect(result.data?.removed).toBe(0);

      const all = service.getAllDeviceTokens();
      expect(all.data).toHaveLength(2);
    });
  });
});
