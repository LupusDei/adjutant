/**
 * ConnectionIndicator - Shows current communication method badge in chat header.
 *
 * States match AdjutantMode.md spec:
 * - ◉ WS (green, pulsing) — WebSocket connected
 * - ◎ SSE (yellow) — SSE fallback
 * - ○ HTTP (gray) — Polling mode
 * - ◉ WS ⚡ (green + bolt) — WebSocket + actively streaming
 * - ⚠ RECONNECTING (orange, flashing) — Connection lost, attempting recovery
 */

import React from 'react';
import type { ConnectionMethod, ConnectionState } from '../../hooks/useConnectionManager';

export interface ConnectionIndicatorProps {
  method: ConnectionMethod;
  state: ConnectionState;
  isStreaming: boolean;
}

export const ConnectionIndicator: React.FC<ConnectionIndicatorProps> = ({
  method,
  state,
  isStreaming,
}) => {
  if (state === 'reconnecting') {
    return (
      <span className="conn-indicator conn-reconnecting" title="Reconnecting...">
        <span className="conn-dot">&#x26A0;</span>
        <span className="conn-label">RECONNECTING</span>
      </span>
    );
  }

  if (state === 'disconnected') {
    return (
      <span className="conn-indicator conn-disconnected" title="Disconnected">
        <span className="conn-dot">&#x25CB;</span>
        <span className="conn-label">OFFLINE</span>
      </span>
    );
  }

  switch (method) {
    case 'ws':
      return (
        <span
          className={`conn-indicator conn-ws ${isStreaming ? 'conn-streaming' : ''}`}
          title={isStreaming ? 'WebSocket connected, streaming' : 'WebSocket connected'}
        >
          <span className="conn-dot">&#x25C9;</span>
          <span className="conn-label">WS</span>
          {isStreaming && <span className="conn-bolt">&#x26A1;</span>}
        </span>
      );

    case 'sse':
      return (
        <span className="conn-indicator conn-sse" title="SSE fallback">
          <span className="conn-dot">&#x25CE;</span>
          <span className="conn-label">SSE</span>
        </span>
      );

    case 'http':
      return (
        <span className="conn-indicator conn-http" title="HTTP polling">
          <span className="conn-dot">&#x25CB;</span>
          <span className="conn-label">HTTP</span>
        </span>
      );
  }
};

export default ConnectionIndicator;
