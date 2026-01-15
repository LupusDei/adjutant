import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../../src/services/bd-client.js", () => ({
  execBd: vi.fn(),
  resolveBeadsDir: vi.fn(() => "/tmp/town/.beads"),
}));

vi.mock("../../src/services/gastown-workspace.js", () => ({
  resolveTownRoot: vi.fn(() => "/tmp/town"),
  resolveGtBinary: vi.fn(() => "gt"),
}));

vi.mock("../../src/services/mail-data.js", () => ({
  listMailIssues: vi.fn(),
}));

import { execBd } from "../../src/services/bd-client.js";
import { listMailIssues } from "../../src/services/mail-data.js";
import { getMessage, listMail, markRead, sendMail } from "../../src/services/mail-service.js";
import type { BeadsIssue } from "../../src/services/bd-client.js";

function createBeadsMessage(overrides: Partial<BeadsIssue> = {}): BeadsIssue {
  return {
    id: "msg-001",
    title: "Test Subject",
    description: "Test body",
    status: "open",
    priority: 2,
    issue_type: "message",
    created_at: "2026-01-11T12:00:00Z",
    assignee: "overseer",
    labels: ["from:mayor/"],
    ...overrides,
  };
}

describe("mail-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listMail", () => {
    it("returns messages sorted by newest first", async () => {
      const older = createBeadsMessage({ id: "msg-001", created_at: "2026-01-10T12:00:00Z" });
      const newer = createBeadsMessage({ id: "msg-002", created_at: "2026-01-11T12:00:00Z" });
      vi.mocked(listMailIssues).mockResolvedValue([older, newer]);

      const result = await listMail();

      expect(result.success).toBe(true);
      expect(result.data?.[0].id).toBe("msg-002");
      expect(result.data?.[1].id).toBe("msg-001");
    });

    it("returns error when list fails", async () => {
      vi.mocked(listMailIssues).mockRejectedValue(new Error("bd failure"));

      const result = await listMail();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("LIST_MAIL_ERROR");
    });
  });

  describe("getMessage", () => {
    it("returns a message by ID", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: [createBeadsMessage({ id: "msg-123" })],
        exitCode: 0,
      });

      const result = await getMessage("msg-123");

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe("msg-123");
    });

    it("returns NOT_FOUND when message missing", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: false,
        error: { code: "COMMAND_FAILED", message: "not found" },
        exitCode: 1,
      });

      const result = await getMessage("msg-999");

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NOT_FOUND");
    });
  });

  describe("sendMail", () => {
    it("sends a message with labels and priority", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: "",
        exitCode: 0,
      });

      const result = await sendMail({
        subject: "Hello",
        body: "Body",
        to: "mayor/",
        type: "task",
        priority: 1,
      });

      expect(result.success).toBe(true);
      const args = vi.mocked(execBd).mock.calls[0]?.[0] ?? [];
      expect(args).toContain("--assignee");
      expect(args).toContain("mayor/");
      expect(args).toContain("--priority");
      expect(args).toContain("1");
      const labelIndex = args.indexOf("--labels");
      const labelValue = labelIndex >= 0 ? (args[labelIndex + 1] ?? "") : "";
      expect(labelValue).toContain("from:");
      expect(labelValue).toContain("thread:");
    });
  });

  describe("markRead", () => {
    it("marks a message as read", async () => {
      vi.mocked(execBd).mockResolvedValue({
        success: true,
        data: "",
        exitCode: 0,
      });

      const result = await markRead("msg-001");

      expect(result.success).toBe(true);
      expect(vi.mocked(execBd)).toHaveBeenCalledWith(
        ["label", "add", "msg-001", "read"],
        expect.any(Object)
      );
    });
  });
});
