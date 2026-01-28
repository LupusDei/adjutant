import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";

// Mock fs and os before importing the service
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("os", () => ({
  homedir: vi.fn(() => "/home/test"),
}));

// Import after mocking
import {
  generateApiKey,
  validateApiKey,
  listApiKeys,
  revokeApiKey,
  hasApiKeys,
} from "../../src/services/api-key-service.js";

describe("api-key-service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Reset module state by re-importing would be ideal, but we'll work with what we have
    // Clear any cached state by returning empty store
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  describe("generateApiKey", () => {
    it("generates a key with adj_ prefix", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);

      const key = generateApiKey();

      expect(key).toMatch(/^adj_[a-f0-9]{64}$/);
    });

    it("stores the hashed key in the keys file", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);

      generateApiKey("test-label");

      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall?.[1] as string);

      expect(writtenData.keys).toHaveLength(1);
      expect(writtenData.keys[0].label).toBe("test-label");
      expect(writtenData.keys[0].hash).toMatch(/^[a-f0-9]{64}$/);
      expect(writtenData.keys[0].createdAt).toBeDefined();
    });

    it("creates directory if it does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);

      generateApiKey();

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining(".gastown"),
        { recursive: true }
      );
    });
  });

  describe("validateApiKey", () => {
    it("returns true for a valid key", () => {
      // Generate a key first
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);

      const key = generateApiKey();

      // Now mock reading the store with the generated hash
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall?.[1] as string);

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(writtenData));

      // Force cache invalidation by waiting for cache TTL (or we test with fresh data)
      expect(validateApiKey(key)).toBe(true);
    });

    it("returns false for an invalid key", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ keys: [] }));

      expect(validateApiKey("adj_invalid")).toBe(false);
    });

    it("returns false for empty key", () => {
      expect(validateApiKey("")).toBe(false);
    });
  });

  describe("listApiKeys", () => {
    it("returns empty array when no keys configured", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const keys = listApiKeys();

      expect(keys).toEqual([]);
    });

    it("returns key metadata without revealing the hash", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          keys: [
            {
              hash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
              label: "ios-app",
              createdAt: "2025-01-01T00:00:00.000Z",
            },
          ],
        })
      );

      const keys = listApiKeys();

      expect(keys).toHaveLength(1);
      expect(keys[0]).toEqual({
        label: "ios-app",
        createdAt: "2025-01-01T00:00:00.000Z",
        hashPrefix: "abcdef12",
      });
    });
  });

  describe("revokeApiKey", () => {
    it("removes a key by hash prefix", () => {
      const mockStore = {
        keys: [
          {
            hash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
            label: "test",
            createdAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockStore));
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      const result = revokeApiKey("abcdef12");

      expect(result).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalled();

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall?.[1] as string);
      expect(writtenData.keys).toHaveLength(0);
    });

    it("returns false if key not found", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ keys: [] }));

      const result = revokeApiKey("notfound");

      expect(result).toBe(false);
    });
  });

  describe("hasApiKeys", () => {
    it("returns true after generating a key (integrated test)", () => {
      // Track what gets written to disk
      let storedData = "";
      vi.mocked(fs.existsSync).mockImplementation(() => storedData !== "");
      vi.mocked(fs.writeFileSync).mockImplementation((_path, data) => {
        storedData = data as string;
      });
      vi.mocked(fs.readFileSync).mockImplementation(() => storedData);
      vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);

      // Generate a key - this writes to "disk" (our mock)
      generateApiKey("test");

      // After generating, hasApiKeys should find the key when it reloads
      expect(hasApiKeys()).toBe(true);
    });
  });
});
