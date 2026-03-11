import { describe, it, expect } from "vitest";
import type { ServiceResult, ServiceError } from "../../src/types/service-result.js";
import { ok, fail } from "../../src/types/service-result.js";

describe("ServiceResult", () => {
  describe("type compatibility", () => {
    it("should support generic success result", () => {
      const result: ServiceResult<string[]> = {
        success: true,
        data: ["item1", "item2"],
      };
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it("should support error result", () => {
      const result: ServiceResult<never> = {
        success: false,
        error: { code: "NOT_FOUND", message: "Resource not found" },
      };
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NOT_FOUND");
    });

    it("should be structurally compatible with legacy result types", () => {
      // ServiceResult is a drop-in replacement for all per-service result types
      const result: ServiceResult<{ id: string }> = {
        success: true,
        data: { id: "test-123" },
      };

      // Can be assigned to any legacy type alias since they all resolve to ServiceResult
      const asServiceResult: ServiceResult<{ id: string }> = result;
      expect(asServiceResult.data?.id).toBe("test-123");
    });
  });

  describe("ok() helper", () => {
    it("should create a success result", () => {
      const result = ok({ count: 42 });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ count: 42 });
      expect(result.error).toBeUndefined();
    });

    it("should work with primitive types", () => {
      const result = ok("hello");
      expect(result.success).toBe(true);
      expect(result.data).toBe("hello");
    });

    it("should work with arrays", () => {
      const result = ok([1, 2, 3]);
      expect(result.success).toBe(true);
      expect(result.data).toEqual([1, 2, 3]);
    });
  });

  describe("fail() helper", () => {
    it("should create a failure result", () => {
      const result = fail("NOT_FOUND", "Bead not found");
      expect(result.success).toBe(false);
      expect(result.error).toEqual({ code: "NOT_FOUND", message: "Bead not found" });
      expect(result.data).toBeUndefined();
    });

    it("should be assignable to any ServiceResult<T>", () => {
      // fail() returns ServiceResult<never> which is assignable to any ServiceResult<T>
      const result: ServiceResult<string[]> = fail("ERR", "something broke");
      expect(result.success).toBe(false);
    });
  });

  describe("ServiceError", () => {
    it("should have code and message fields", () => {
      const error: ServiceError = { code: "TIMEOUT", message: "Request timed out" };
      expect(error.code).toBe("TIMEOUT");
      expect(error.message).toBe("Request timed out");
    });
  });
});
