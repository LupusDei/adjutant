import { describe, it, expect } from "vitest";

import {
  BehaviorRegistry,
  type AdjutantBehavior,
} from "../../../src/services/adjutant/behavior-registry.js";

function createTestBehavior(
  overrides: Partial<AdjutantBehavior> = {},
): AdjutantBehavior {
  return {
    name: "test-behavior",
    triggers: ["agent:status_changed"],
    shouldAct: () => true,
    act: async () => {},
    ...overrides,
  };
}

describe("BehaviorRegistry", () => {
  it("register adds a behavior to the registry", () => {
    const registry = new BehaviorRegistry();
    const behavior = createTestBehavior();
    registry.register(behavior);
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.getAll()[0]).toEqual(behavior);
  });

  it("register throws on duplicate name", () => {
    const registry = new BehaviorRegistry();
    registry.register(createTestBehavior({ name: "dup" }));
    expect(() => registry.register(createTestBehavior({ name: "dup" }))).toThrow(
      /already registered/,
    );
  });

  it("getBehaviorsForEvent returns matching behaviors", () => {
    const registry = new BehaviorRegistry();
    const behavior = createTestBehavior({
      name: "status-watcher",
      triggers: ["agent:status_changed"],
    });
    registry.register(behavior);

    const result = registry.getBehaviorsForEvent("agent:status_changed");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(behavior);
  });

  it("getBehaviorsForEvent returns empty array for unmatched event", () => {
    const registry = new BehaviorRegistry();
    registry.register(
      createTestBehavior({ name: "status-only", triggers: ["agent:status_changed"] }),
    );

    const result = registry.getBehaviorsForEvent("bead:created");
    expect(result).toHaveLength(0);
  });

  it("getBehaviorsForEvent returns multiple behaviors if multiple match", () => {
    const registry = new BehaviorRegistry();
    registry.register(
      createTestBehavior({ name: "watcher-a", triggers: ["bead:updated"] }),
    );
    registry.register(
      createTestBehavior({ name: "watcher-b", triggers: ["bead:updated", "bead:closed"] }),
    );

    const result = registry.getBehaviorsForEvent("bead:updated");
    expect(result).toHaveLength(2);
  });

  it("getScheduledBehaviors returns only behaviors with schedule", () => {
    const registry = new BehaviorRegistry();
    registry.register(
      createTestBehavior({ name: "scheduled", schedule: "0 * * * *" }),
    );
    registry.register(
      createTestBehavior({ name: "unscheduled" }),
    );

    const result = registry.getScheduledBehaviors();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("scheduled");
  });

  it("getScheduledBehaviors returns empty array when none scheduled", () => {
    const registry = new BehaviorRegistry();
    registry.register(createTestBehavior({ name: "no-schedule" }));

    const result = registry.getScheduledBehaviors();
    expect(result).toHaveLength(0);
  });

  it("getAll returns all registered behaviors", () => {
    const registry = new BehaviorRegistry();
    registry.register(createTestBehavior({ name: "a" }));
    registry.register(createTestBehavior({ name: "b" }));
    registry.register(createTestBehavior({ name: "c" }));

    expect(registry.getAll()).toHaveLength(3);
  });

  it("getAll returns a copy (modifying returned array doesn't affect registry)", () => {
    const registry = new BehaviorRegistry();
    registry.register(createTestBehavior({ name: "original" }));

    const copy = registry.getAll();
    copy.push(createTestBehavior({ name: "injected" }));

    expect(registry.getAll()).toHaveLength(1);
  });

  it("getByName returns behavior by name", () => {
    const registry = new BehaviorRegistry();
    const behavior = createTestBehavior({ name: "finder-target" });
    registry.register(behavior);

    expect(registry.getByName("finder-target")).toEqual(behavior);
  });

  it("getByName returns undefined for unknown name", () => {
    const registry = new BehaviorRegistry();
    expect(registry.getByName("nonexistent")).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // adj-p9i6: Reject dead behaviors (no triggers AND no schedule)
  // ---------------------------------------------------------------------------

  describe("dead behavior rejection", () => {
    it("throws when registering behavior with empty triggers and no schedule", () => {
      const registry = new BehaviorRegistry();
      expect(() =>
        registry.register(
          createTestBehavior({ name: "dead", triggers: [], schedule: undefined }),
        ),
      ).toThrow(/no triggers and no schedule/);
    });

    it("does NOT throw when behavior has only triggers (no schedule)", () => {
      const registry = new BehaviorRegistry();
      expect(() =>
        registry.register(
          createTestBehavior({ name: "trigger-only", triggers: ["agent:status_changed"] }),
        ),
      ).not.toThrow();
    });

    it("does NOT throw when behavior has only schedule (no triggers)", () => {
      const registry = new BehaviorRegistry();
      expect(() =>
        registry.register(
          createTestBehavior({ name: "schedule-only", triggers: [], schedule: "0 * * * *" }),
        ),
      ).not.toThrow();
    });

    it("does NOT throw when behavior has both triggers and schedule", () => {
      const registry = new BehaviorRegistry();
      expect(() =>
        registry.register(
          createTestBehavior({
            name: "both",
            triggers: ["agent:status_changed"],
            schedule: "0 * * * *",
          }),
        ),
      ).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // adj-5saq: unregister() and clear()
  // ---------------------------------------------------------------------------

  describe("unregister", () => {
    it("returns true and removes behavior", () => {
      const registry = new BehaviorRegistry();
      registry.register(createTestBehavior({ name: "removable" }));
      expect(registry.getAll()).toHaveLength(1);

      const result = registry.unregister("removable");
      expect(result).toBe(true);
      expect(registry.getAll()).toHaveLength(0);
      expect(registry.getByName("removable")).toBeUndefined();
    });

    it("returns false for unknown name", () => {
      const registry = new BehaviorRegistry();
      const result = registry.unregister("nonexistent");
      expect(result).toBe(false);
    });

    it("can register after unregister with same name", () => {
      const registry = new BehaviorRegistry();
      registry.register(createTestBehavior({ name: "reuse" }));
      registry.unregister("reuse");
      expect(() =>
        registry.register(createTestBehavior({ name: "reuse" })),
      ).not.toThrow();
      expect(registry.getAll()).toHaveLength(1);
    });
  });

  describe("clear", () => {
    it("empties the registry", () => {
      const registry = new BehaviorRegistry();
      registry.register(createTestBehavior({ name: "a" }));
      registry.register(createTestBehavior({ name: "b" }));
      registry.register(createTestBehavior({ name: "c" }));
      expect(registry.getAll()).toHaveLength(3);

      registry.clear();
      expect(registry.getAll()).toHaveLength(0);
    });
  });

});
