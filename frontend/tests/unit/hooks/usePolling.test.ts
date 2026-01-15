import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePolling } from "../../../src/hooks/usePolling";

describe("usePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllTimers();
  });

  it("should fetch data immediately when immediate is true (default)", async () => {
    const mockData = { value: "test" };
    const fetchFn = vi.fn().mockResolvedValue(mockData);

    const { result } = renderHook(() => usePolling(fetchFn));

    expect(result.current.loading).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Flush microtask queue for promise resolution
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual(mockData);
    expect(result.current.error).toBeNull();
    expect(result.current.lastUpdated).toBeInstanceOf(Date);
  });

  it("should not fetch immediately when immediate is false", () => {
    const fetchFn = vi.fn().mockResolvedValue({ value: "test" });

    renderHook(() => usePolling(fetchFn, { immediate: false }));

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("should poll at the specified interval", async () => {
    const mockData = { value: "test" };
    const fetchFn = vi.fn().mockResolvedValue(mockData);
    const interval = 3000;

    const { result } = renderHook(() => usePolling(fetchFn, { interval }));

    // Wait for initial fetch
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Advance timer to trigger next poll
    await act(async () => {
      vi.advanceTimersByTime(interval);
      await Promise.resolve();
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);

    // Advance again
    await act(async () => {
      vi.advanceTimersByTime(interval);
      await Promise.resolve();
    });

    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("should handle fetch errors", async () => {
    const error = new Error("Fetch failed");
    const fetchFn = vi.fn().mockRejectedValue(error);

    const { result } = renderHook(() => usePolling(fetchFn));

    await act(async () => {
      await Promise.resolve();
      // Need extra tick for catch block
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toEqual(error);
  });

  it("should convert non-Error throws to Error objects", async () => {
    const fetchFn = vi.fn().mockRejectedValue("string error");

    const { result } = renderHook(() => usePolling(fetchFn));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("string error");
  });

  it("should allow manual refresh", async () => {
    const mockData = { value: "test" };
    const fetchFn = vi.fn().mockResolvedValue(mockData);

    const { result } = renderHook(() =>
      usePolling(fetchFn, { immediate: false })
    );

    expect(fetchFn).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.refresh();
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(mockData);
  });

  it("should not fetch when enabled is false", () => {
    const fetchFn = vi.fn().mockResolvedValue({ value: "test" });

    renderHook(() => usePolling(fetchFn, { enabled: false }));

    expect(fetchFn).not.toHaveBeenCalled();

    // Advance timers - should still not fetch
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("should cleanup interval on unmount", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ value: "test" });
    const interval = 5000;

    const { result, unmount } = renderHook(() =>
      usePolling(fetchFn, { interval })
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    unmount();

    // Advance timers - should not trigger more fetches after unmount
    vi.advanceTimersByTime(interval * 3);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("should clear error on successful fetch", async () => {
    const error = new Error("Fetch failed");
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ value: "success" });

    const { result } = renderHook(() => usePolling(fetchFn, { interval: 1000 }));

    // Wait for first fetch (error)
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.error).toEqual(error);
    expect(result.current.data).toBeNull();

    // Trigger next poll
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual({ value: "success" });
  });

  it("should use default interval of 5000ms", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ value: "test" });

    const { result } = renderHook(() => usePolling(fetchFn));

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Advance by less than default interval
    vi.advanceTimersByTime(4000);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Advance past default interval
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
