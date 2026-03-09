import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before imports
vi.mock("@parse/node-apn", () => {
  const mockSend = vi.fn();
  const mockShutdown = vi.fn();
  const MockProvider = vi.fn().mockImplementation(() => ({
    send: mockSend,
    shutdown: mockShutdown,
  }));
  const MockNotification = vi.fn().mockImplementation(() => ({
    alert: null,
    topic: null,
    badge: undefined,
    sound: undefined,
    category: undefined,
    threadId: undefined,
    payload: undefined,
    expiry: 0,
  }));
  return {
    default: { Provider: MockProvider, Notification: MockNotification },
    Provider: MockProvider,
    Notification: MockNotification,
  };
});

vi.mock("../../src/services/device-token-service.js", () => ({
  getAllDeviceTokens: vi.fn(),
  unregisterDeviceToken: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("../../src/utils/index.js", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

import * as apn from "@parse/node-apn";
import { unregisterDeviceToken } from "../../src/services/device-token-service.js";

describe("apns-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module to clear cached provider
    vi.resetModules();
  });

  describe("sendNotification", () => {
    it("should unregister token when APNS returns BadDeviceToken", async () => {
      // Re-mock after resetModules
      vi.doMock("@parse/node-apn", () => {
        const mockSend = vi.fn().mockResolvedValue({
          sent: [],
          failed: [{ device: "deadbeef", status: 400, response: { reason: "BadDeviceToken" } }],
        });
        return {
          default: {
            Provider: vi.fn().mockImplementation(() => ({ send: mockSend, shutdown: vi.fn() })),
            Notification: vi.fn().mockImplementation(() => ({})),
          },
          Provider: vi.fn().mockImplementation(() => ({ send: mockSend, shutdown: vi.fn() })),
          Notification: vi.fn().mockImplementation(() => ({})),
        };
      });

      vi.doMock("../../src/services/device-token-service.js", () => ({
        getAllDeviceTokens: vi.fn(),
        unregisterDeviceToken: vi.fn().mockResolvedValue({ success: true }),
      }));

      vi.doMock("../../src/utils/index.js", () => ({
        logInfo: vi.fn(),
        logError: vi.fn(),
        logWarn: vi.fn(),
        logDebug: vi.fn(),
      }));

      // Set env vars for APNS config
      process.env["APNS_TEAM_ID"] = "test-team";
      process.env["APNS_KEY_ID"] = "test-key";
      process.env["APNS_BUNDLE_ID"] = "com.test.app";
      process.env["APNS_KEY_PATH"] = "/tmp/fake-key.p8";
      process.env["APNS_ENVIRONMENT"] = "production";

      // Mock existsSync to say key file exists
      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(true),
      }));

      const { sendNotification } = await import("../../src/services/apns-service.js");
      const { unregisterDeviceToken: mockUnregister } = await import(
        "../../src/services/device-token-service.js"
      );

      const result = await sendNotification("deadbeef", {
        title: "Test",
        body: "Test notification",
      });

      expect(result.success).toBe(false);
      expect(result.data?.reason).toBe("BadDeviceToken");
      expect(mockUnregister).toHaveBeenCalledWith("deadbeef");
    });

    it("should NOT unregister token for other APNS failures", async () => {
      vi.doMock("@parse/node-apn", () => {
        const mockSend = vi.fn().mockResolvedValue({
          sent: [],
          failed: [{ device: "aabbccdd", status: 400, response: { reason: "PayloadTooLarge" } }],
        });
        return {
          default: {
            Provider: vi.fn().mockImplementation(() => ({ send: mockSend, shutdown: vi.fn() })),
            Notification: vi.fn().mockImplementation(() => ({})),
          },
          Provider: vi.fn().mockImplementation(() => ({ send: mockSend, shutdown: vi.fn() })),
          Notification: vi.fn().mockImplementation(() => ({})),
        };
      });

      vi.doMock("../../src/services/device-token-service.js", () => ({
        getAllDeviceTokens: vi.fn(),
        unregisterDeviceToken: vi.fn().mockResolvedValue({ success: true }),
      }));

      vi.doMock("../../src/utils/index.js", () => ({
        logInfo: vi.fn(),
        logError: vi.fn(),
        logWarn: vi.fn(),
        logDebug: vi.fn(),
      }));

      process.env["APNS_TEAM_ID"] = "test-team";
      process.env["APNS_KEY_ID"] = "test-key";
      process.env["APNS_BUNDLE_ID"] = "com.test.app";
      process.env["APNS_KEY_PATH"] = "/tmp/fake-key.p8";
      process.env["APNS_ENVIRONMENT"] = "production";

      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(true),
      }));

      const { sendNotification } = await import("../../src/services/apns-service.js");
      const { unregisterDeviceToken: mockUnregister } = await import(
        "../../src/services/device-token-service.js"
      );

      await sendNotification("aabbccdd", {
        title: "Test",
        body: "Test notification",
      });

      expect(mockUnregister).not.toHaveBeenCalled();
    });

    it("should also unregister token for Unregistered reason", async () => {
      vi.doMock("@parse/node-apn", () => {
        const mockSend = vi.fn().mockResolvedValue({
          sent: [],
          failed: [{ device: "aabbccdd", status: 410, response: { reason: "Unregistered" } }],
        });
        return {
          default: {
            Provider: vi.fn().mockImplementation(() => ({ send: mockSend, shutdown: vi.fn() })),
            Notification: vi.fn().mockImplementation(() => ({})),
          },
          Provider: vi.fn().mockImplementation(() => ({ send: mockSend, shutdown: vi.fn() })),
          Notification: vi.fn().mockImplementation(() => ({})),
        };
      });

      vi.doMock("../../src/services/device-token-service.js", () => ({
        getAllDeviceTokens: vi.fn(),
        unregisterDeviceToken: vi.fn().mockResolvedValue({ success: true }),
      }));

      vi.doMock("../../src/utils/index.js", () => ({
        logInfo: vi.fn(),
        logError: vi.fn(),
        logWarn: vi.fn(),
        logDebug: vi.fn(),
      }));

      process.env["APNS_TEAM_ID"] = "test-team";
      process.env["APNS_KEY_ID"] = "test-key";
      process.env["APNS_BUNDLE_ID"] = "com.test.app";
      process.env["APNS_KEY_PATH"] = "/tmp/fake-key.p8";
      process.env["APNS_ENVIRONMENT"] = "production";

      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(true),
      }));

      const { sendNotification } = await import("../../src/services/apns-service.js");
      const { unregisterDeviceToken: mockUnregister } = await import(
        "../../src/services/device-token-service.js"
      );

      await sendNotification("aabbccdd", {
        title: "Test",
        body: "Test notification",
      });

      expect(mockUnregister).toHaveBeenCalledWith("aabbccdd");
    });
  });

  describe("getAPNsConfig", () => {
    it("should use APNS_ENVIRONMENT for production flag", async () => {
      vi.doMock("@parse/node-apn", () => {
        const mockSend = vi.fn().mockResolvedValue({ sent: [{ device: "aabb" }], failed: [] });
        const ProviderImpl = vi.fn().mockImplementation(() => ({ send: mockSend, shutdown: vi.fn() }));
        return {
          default: {
            Provider: ProviderImpl,
            Notification: vi.fn().mockImplementation(() => ({})),
          },
          Provider: ProviderImpl,
          Notification: vi.fn().mockImplementation(() => ({})),
        };
      });

      vi.doMock("../../src/services/device-token-service.js", () => ({
        getAllDeviceTokens: vi.fn(),
        unregisterDeviceToken: vi.fn(),
      }));

      vi.doMock("../../src/utils/index.js", () => ({
        logInfo: vi.fn(),
        logError: vi.fn(),
        logWarn: vi.fn(),
        logDebug: vi.fn(),
      }));

      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(true),
      }));

      process.env["APNS_TEAM_ID"] = "test-team";
      process.env["APNS_KEY_ID"] = "test-key";
      process.env["APNS_BUNDLE_ID"] = "com.test.app";
      process.env["APNS_KEY_PATH"] = "/tmp/fake-key.p8";
      process.env["APNS_ENVIRONMENT"] = "production";

      const apnModule = await import("@parse/node-apn");
      const { sendNotification } = await import("../../src/services/apns-service.js");

      await sendNotification("aabb", { title: "Test", body: "Test" });

      // Provider should have been created with production: true
      expect(apnModule.Provider).toHaveBeenCalledWith(
        expect.objectContaining({ production: true })
      );
    });
  });
});
