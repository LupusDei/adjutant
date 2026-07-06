/**
 * Tests for the CommandChat image-attachment composer (adj-203.4.2 / T011).
 *
 * Behaviors:
 *  - attach an image three ways: file-picker button, clipboard paste, drag-drop
 *  - thumbnail preview with a remove control
 *  - on send: upload each file, then post the message with the resulting
 *    attachmentIds; clear the input + previews
 *  - upload failure preserves the draft text AND the pending previews and shows
 *    an error (draft-preserve rule)
 *  - send is allowed with an attachment even when the text field is empty
 *    (screenshot with no caption)
 *
 * CommandChat is rendered in isolation; the hook soup + api client are mocked
 * so the composer is the only thing under test.
 *
 * @module tests/unit/chat-composer-attachments
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";

import type { DisplayMessage } from "../../src/hooks/useChatMessages";
import type { UploadResult } from "../../src/types";

// --- api mock --------------------------------------------------------------
const uploadMock = vi.fn<(file: File) => Promise<UploadResult>>();
vi.mock("../../src/services/api", () => ({
  api: {
    uploads: {
      upload: (file: File) => uploadMock(file),
      url: (id: string) => `/api/uploads/${id}`,
      fetchObjectUrl: (id: string) => Promise.resolve(`blob:${id}`),
    },
    messages: { search: vi.fn().mockResolvedValue({ items: [] }) },
  },
}));

// --- hook soup mocks -------------------------------------------------------
const sendMessageMock = vi.fn<(body: string, opts?: unknown) => Promise<void>>();
let mockMessages: DisplayMessage[] = [];

vi.mock("../../src/hooks/useChatMessages", async () => {
  const actual = await vi.importActual<typeof import("../../src/hooks/useChatMessages")>(
    "../../src/hooks/useChatMessages",
  );
  return {
    ...actual,
    useChatMessages: () => ({
      messages: mockMessages,
      isLoading: false,
      error: null,
      hasMore: false,
      conversationId: "dm_x",
      sendMessage: sendMessageMock,
      addOptimistic: vi.fn(),
      confirmDelivery: vi.fn(),
      markFailed: vi.fn(),
      markRead: vi.fn().mockResolvedValue(undefined),
      loadMore: vi.fn().mockResolvedValue(undefined),
    }),
  };
});

vi.mock("../../src/hooks/useUnreadCounts", () => ({
  useUnreadCounts: () => ({ counts: {}, totalUnread: 0, markRead: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock("../../src/hooks/useVoiceInput", () => ({
  useVoiceInput: () => ({
    isRecording: false, isProcessing: false, transcript: "", error: null,
    startRecording: vi.fn().mockResolvedValue(undefined), stopRecording: vi.fn(), clearTranscript: vi.fn(),
  }),
}));
vi.mock("../../src/hooks/useVoicePlayer", () => ({
  useVoicePlayer: () => ({ isPlaying: false, isLoading: false, play: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }),
}));
vi.mock("../../src/hooks/useChatWebSocket", () => ({
  useChatWebSocket: () => ({ connected: false, connectionStatus: "polling", sendTyping: vi.fn() }),
}));
vi.mock("../../src/contexts/CommunicationContext", async () => {
  const actual = await vi.importActual<typeof import("../../src/contexts/CommunicationContext")>(
    "../../src/contexts/CommunicationContext",
  );
  return {
    ...actual,
    useCommunication: () => ({
      priority: "polling-only", setPriority: vi.fn(), connectionStatus: "polling",
      sendMessage: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(() => () => undefined), subscribeTimeline: vi.fn(() => () => undefined),
    }),
  };
});

import { CommandChat } from "../../src/components/chat/CommandChat";

function makeImage(name = "shot.png"): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type: "image/png" });
}

function fileInput(): HTMLInputElement {
  const el = document.querySelector('input[type="file"]');
  if (!el) throw new Error("no file input in composer");
  return el as HTMLInputElement;
}

/** Build a DataTransfer-like object jsdom accepts on paste/drop events. */
function fileList(files: File[]): { files: File[]; items: { kind: string; type: string; getAsFile: () => File }[] } {
  return {
    files,
    items: files.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })),
  };
}

beforeEach(() => {
  mockMessages = [];
  uploadMock.mockReset();
  sendMessageMock.mockReset();
  sendMessageMock.mockResolvedValue(undefined);
  globalThis.URL.createObjectURL = vi.fn(() => "blob:preview");
  globalThis.URL.revokeObjectURL = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
   
  delete (Element.prototype as any).scrollIntoView;
});

describe("CommandChat attachment composer", () => {
  it("adds a thumbnail preview when a file is chosen via the picker", async () => {
    render(<CommandChat agentId="raynor" />);
    fireEvent.change(fileInput(), { target: { files: [makeImage()] } });

    await waitFor(() => {
      expect(screen.getByRole("img", { name: /shot\.png/i })).toBeInTheDocument();
    });
  });

  it("adds a preview when an image is pasted into the composer", async () => {
    render(<CommandChat agentId="raynor" />);
    const input = screen.getByPlaceholderText(/type or record message/i);
    fireEvent.paste(input, { clipboardData: fileList([makeImage("pasted.png")]) });

    await waitFor(() => {
      expect(screen.getByRole("img", { name: /pasted\.png/i })).toBeInTheDocument();
    });
  });

  it("adds a preview when an image file is dropped on the composer", async () => {
    const { container } = render(<CommandChat agentId="raynor" />);
    const root = container.querySelector(".command-chat")!;
    fireEvent.drop(root, { dataTransfer: fileList([makeImage("dropped.png")]) });

    await waitFor(() => {
      expect(screen.getByRole("img", { name: /dropped\.png/i })).toBeInTheDocument();
    });
  });

  it("removes a preview when its remove control is clicked", async () => {
    render(<CommandChat agentId="raynor" />);
    fireEvent.change(fileInput(), { target: { files: [makeImage()] } });

    const removeBtn = await screen.findByRole("button", { name: /remove shot\.png/i });
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(screen.queryByRole("img", { name: /shot\.png/i })).not.toBeInTheDocument();
    });
  });

  it("uploads each attachment then sends the message with the resulting attachmentIds", async () => {
    uploadMock.mockResolvedValueOnce({ id: "att-9", filename: "shot.png", mimeType: "image/png", sizeBytes: 4 });
    render(<CommandChat agentId="raynor" />);

    fireEvent.change(fileInput(), { target: { files: [makeImage()] } });
    await screen.findByRole("img", { name: /shot\.png/i });

    const input = screen.getByPlaceholderText(/type or record message/i);
    fireEvent.change(input, { target: { value: "check this" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(uploadMock).toHaveBeenCalledTimes(1);
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });
    const [body, opts] = sendMessageMock.mock.calls[0] as [string, { attachmentIds?: string[] }];
    expect(body).toBe("check this");
    expect(opts.attachmentIds).toEqual(["att-9"]);

    // Previews + input cleared after a successful send.
    await waitFor(() => {
      expect(screen.queryByRole("img", { name: /shot\.png/i })).not.toBeInTheDocument();
    });
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("preserves the draft text and previews and shows an error when upload fails", async () => {
    uploadMock.mockRejectedValueOnce(new Error("Upload exceeds 10485760 bytes"));
    render(<CommandChat agentId="raynor" />);

    fireEvent.change(fileInput(), { target: { files: [makeImage()] } });
    await screen.findByRole("img", { name: /shot\.png/i });

    const input = screen.getByPlaceholderText(/type or record message/i);
    fireEvent.change(input, { target: { value: "keep me" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/upload/i);
    });
    // The message send never happened, and the draft + preview are preserved.
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(screen.getByRole("img", { name: /shot\.png/i })).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe("keep me");
  });

  it("allows send with an attachment even when the text field is empty", async () => {
    uploadMock.mockResolvedValueOnce({ id: "att-1", filename: "shot.png", mimeType: "image/png", sizeBytes: 4 });
    render(<CommandChat agentId="raynor" />);

    fireEvent.change(fileInput(), { target: { files: [makeImage()] } });
    await screen.findByRole("img", { name: /shot\.png/i });

    const sendBtn = screen.getByRole("button", { name: /^send$/i });
    expect(sendBtn).not.toBeDisabled();

    fireEvent.click(sendBtn);
    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });
    const [body, opts] = sendMessageMock.mock.calls[0] as [string, { attachmentIds?: string[] }];
    expect(body).toBe("");
    expect(opts.attachmentIds).toEqual(["att-1"]);
  });

  it("ignores non-image files on drop", async () => {
    const { container } = render(<CommandChat agentId="raynor" />);
    const root = container.querySelector(".command-chat")!;
    const pdf = new File([new Uint8Array([1])], "doc.pdf", { type: "application/pdf" });
    act(() => {
      fireEvent.drop(root, { dataTransfer: fileList([pdf]) });
    });

    // No preview image should appear.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
