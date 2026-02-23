import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMediaQuery, useIsMobile } from "../../../src/hooks/useMediaQuery";

// =============================================================================
// Mock Setup
// =============================================================================

interface MockMediaQueryList {
  matches: boolean;
  media: string;
  onchange: ((event: MediaQueryListEvent) => void) | null;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  addListener: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  dispatchEvent: ReturnType<typeof vi.fn>;
  triggerChange: (matches: boolean) => void;
}

function createMockMediaQueryList(initialMatches: boolean): MockMediaQueryList {
  const listeners: ((event: MediaQueryListEvent) => void)[] = [];

  return {
    matches: initialMatches,
    media: "",
    onchange: null,
    addEventListener: vi.fn((event: string, handler: (event: MediaQueryListEvent) => void) => {
      if (event === "change") {
        listeners.push(handler);
      }
    }),
    removeEventListener: vi.fn((event: string, handler: (event: MediaQueryListEvent) => void) => {
      if (event === "change") {
        const index = listeners.indexOf(handler);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    triggerChange: (matches: boolean) => {
      const event = { matches } as MediaQueryListEvent;
      listeners.forEach(listener => { listener(event); });
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("useMediaQuery", () => {
  let mockMatchMedia: ReturnType<typeof vi.fn>;
  let mockMediaQueryList: MockMediaQueryList;

  beforeEach(() => {
    mockMediaQueryList = createMockMediaQueryList(false);
    mockMatchMedia = vi.fn(() => mockMediaQueryList);
    window.matchMedia = mockMatchMedia;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // Initial State
  // ===========================================================================

  describe("initial state", () => {
    it("should return false when query does not match", () => {
      mockMediaQueryList.matches = false;

      const { result } = renderHook(() => useMediaQuery("(max-width: 768px)"));

      expect(result.current).toBe(false);
    });

    it("should return true when query matches", () => {
      mockMediaQueryList.matches = true;

      const { result } = renderHook(() => useMediaQuery("(max-width: 768px)"));

      expect(result.current).toBe(true);
    });

    it("should call window.matchMedia with the provided query", () => {
      renderHook(() => useMediaQuery("(min-width: 1024px)"));

      expect(mockMatchMedia).toHaveBeenCalledWith("(min-width: 1024px)");
    });
  });

  // ===========================================================================
  // Event Handling
  // ===========================================================================

  describe("event handling", () => {
    it("should add change event listener on mount", () => {
      renderHook(() => useMediaQuery("(max-width: 768px)"));

      expect(mockMediaQueryList.addEventListener).toHaveBeenCalledWith(
        "change",
        expect.any(Function)
      );
    });

    it("should remove change event listener on unmount", () => {
      const { unmount } = renderHook(() => useMediaQuery("(max-width: 768px)"));

      unmount();

      expect(mockMediaQueryList.removeEventListener).toHaveBeenCalledWith(
        "change",
        expect.any(Function)
      );
    });

    it("should update when media query changes", () => {
      mockMediaQueryList.matches = false;
      const { result } = renderHook(() => useMediaQuery("(max-width: 768px)"));

      expect(result.current).toBe(false);

      act(() => {
        mockMediaQueryList.triggerChange(true);
      });

      expect(result.current).toBe(true);
    });

    it("should update when media query changes from true to false", () => {
      mockMediaQueryList.matches = true;
      const { result } = renderHook(() => useMediaQuery("(max-width: 768px)"));

      expect(result.current).toBe(true);

      act(() => {
        mockMediaQueryList.triggerChange(false);
      });

      expect(result.current).toBe(false);
    });
  });

  // ===========================================================================
  // Query Changes
  // ===========================================================================

  describe("query changes", () => {
    it("should re-subscribe when query changes", () => {
      const { rerender } = renderHook(
        ({ query }) => useMediaQuery(query),
        { initialProps: { query: "(max-width: 768px)" } }
      );

      expect(mockMatchMedia).toHaveBeenCalledTimes(2); // Initial + effect

      rerender({ query: "(min-width: 1024px)" });

      // Should have removed old listener and added new one
      expect(mockMediaQueryList.removeEventListener).toHaveBeenCalled();
      expect(mockMatchMedia).toHaveBeenCalledWith("(min-width: 1024px)");
    });
  });
});

// =============================================================================
// useIsMobile Tests
// =============================================================================

describe("useIsMobile", () => {
  let mockMediaQueryList: MockMediaQueryList;

  beforeEach(() => {
    mockMediaQueryList = createMockMediaQueryList(false);
    window.matchMedia = vi.fn(() => mockMediaQueryList);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should use 640px breakpoint for mobile detection", () => {
    renderHook(() => useIsMobile());

    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 640px)");
  });

  it("should return true when viewport is mobile-sized", () => {
    mockMediaQueryList.matches = true;

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(true);
  });

  it("should return false when viewport is desktop-sized", () => {
    mockMediaQueryList.matches = false;

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(false);
  });

  it("should respond to viewport size changes", () => {
    mockMediaQueryList.matches = false;
    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(false);

    act(() => {
      mockMediaQueryList.triggerChange(true);
    });

    expect(result.current).toBe(true);
  });
});
