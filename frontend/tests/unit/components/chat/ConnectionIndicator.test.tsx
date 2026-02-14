import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { ConnectionIndicator } from "../../../../src/components/chat/ConnectionIndicator";

describe("ConnectionIndicator", () => {
  describe("WebSocket connected", () => {
    it("should show WS label when WebSocket is connected", () => {
      render(
        <ConnectionIndicator method="ws" state="connected" isStreaming={false} />
      );
      expect(screen.getByText("WS")).toBeDefined();
      expect(screen.getByTitle("WebSocket connected")).toBeDefined();
    });

    it("should show bolt when streaming", () => {
      render(
        <ConnectionIndicator method="ws" state="connected" isStreaming={true} />
      );
      expect(screen.getByText("WS")).toBeDefined();
      expect(screen.getByTitle("WebSocket connected, streaming")).toBeDefined();
    });

    it("should have streaming class when streaming", () => {
      const { container } = render(
        <ConnectionIndicator method="ws" state="connected" isStreaming={true} />
      );
      const indicator = container.querySelector(".conn-indicator");
      expect(indicator?.classList.contains("conn-streaming")).toBe(true);
    });
  });

  describe("SSE connected", () => {
    it("should show SSE label when SSE is connected", () => {
      render(
        <ConnectionIndicator method="sse" state="connected" isStreaming={false} />
      );
      expect(screen.getByText("SSE")).toBeDefined();
      expect(screen.getByTitle("SSE fallback")).toBeDefined();
    });

    it("should have sse class", () => {
      const { container } = render(
        <ConnectionIndicator method="sse" state="connected" isStreaming={false} />
      );
      expect(container.querySelector(".conn-sse")).toBeDefined();
    });
  });

  describe("HTTP polling", () => {
    it("should show HTTP label in polling mode", () => {
      render(
        <ConnectionIndicator method="http" state="connected" isStreaming={false} />
      );
      expect(screen.getByText("HTTP")).toBeDefined();
      expect(screen.getByTitle("HTTP polling")).toBeDefined();
    });

    it("should have http class", () => {
      const { container } = render(
        <ConnectionIndicator method="http" state="connected" isStreaming={false} />
      );
      expect(container.querySelector(".conn-http")).toBeDefined();
    });
  });

  describe("reconnecting", () => {
    it("should show RECONNECTING when reconnecting", () => {
      render(
        <ConnectionIndicator method="ws" state="reconnecting" isStreaming={false} />
      );
      expect(screen.getByText("RECONNECTING")).toBeDefined();
    });

    it("should have reconnecting class", () => {
      const { container } = render(
        <ConnectionIndicator method="ws" state="reconnecting" isStreaming={false} />
      );
      expect(container.querySelector(".conn-reconnecting")).toBeDefined();
    });
  });

  describe("disconnected", () => {
    it("should show OFFLINE when disconnected", () => {
      render(
        <ConnectionIndicator method="http" state="disconnected" isStreaming={false} />
      );
      expect(screen.getByText("OFFLINE")).toBeDefined();
    });

    it("should have disconnected class", () => {
      const { container } = render(
        <ConnectionIndicator method="http" state="disconnected" isStreaming={false} />
      );
      expect(container.querySelector(".conn-disconnected")).toBeDefined();
    });
  });
});
