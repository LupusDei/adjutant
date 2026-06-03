/**
 * Real Dolt SQL-handshake probe (adj-182.2.1.r3 / adj-182.2.2.1).
 *
 * Replaces the old bare-TCP connect probe. The bare-TCP probe resolved `true` the
 * instant ANY process accepted the socket on the pinned port — so a rogue/squatter
 * (or an unrelated service that happens to bind the port) FALSE-PASSED verification.
 * That false-positive is what let a first install bootstrap a SECOND supervised server
 * on a data-dir already owned by a rogue (two servers, one data-dir → double-open).
 *
 * This probe instead validates a real MySQL/Dolt protocol handshake. Dolt's
 * `sql-server` (a MySQL-wire server) sends its Initial Handshake Packet (the
 * "greeting") to the client IMMEDIATELY on connect — before the client writes a
 * single byte. We connect, read that first packet, and verify it is a genuine
 * MySQL-protocol greeting:
 *   - 4-byte packet header: 3-byte little-endian payload length + 1-byte sequence id.
 *   - The greeting always has sequence id 0.
 *   - The first payload byte is the protocol version: 10 (modern) or 9 (legacy).
 *   - The declared payload length is sane (non-zero, not absurd).
 *
 * A bare-TCP squatter that never speaks MySQL — or sends HTTP/garbage — fails all of
 * these and the probe resolves `false`. We never need a full auth round-trip or a
 * mysql client dependency: the unsolicited server greeting is sufficient to prove a
 * real Dolt/MySQL server is the port owner.
 *
 * SAFETY / TESTABILITY: the transport is an INJECTED seam ({@link ConnectSeam}) so the
 * probe never opens a real socket in a test. The default seam uses `net.createConnection`
 * against loopback only.
 */

import { createConnection } from "net";

/** Modern MySQL protocol version (HandshakeV10). */
const MYSQL_PROTOCOL_V10 = 10;
/** Legacy MySQL protocol version (HandshakeV9). Accepted defensively. */
const MYSQL_PROTOCOL_V9 = 9;
/** Upper sanity bound on the greeting payload length (a real greeting is well under this). */
const MAX_GREETING_PAYLOAD = 4096;
/** Default probe timeout (ms). */
const DEFAULT_TIMEOUT_MS = 1000;

/**
 * The minimal socket surface the probe drives. Mirrors the subset of `net.Socket`
 * we use, so tests can inject a scriptable fake without a real connection.
 */
export interface ProbeSocket {
  once(event: string, listener: (arg?: unknown) => void): void;
  on(event: string, listener: (arg?: unknown) => void): void;
  setTimeout(ms: number): void;
  destroy(): void;
}

/** Open a connection to `{ host, port }` and return the socket (the transport seam). */
export type ConnectSeam = (opts: { host: string; port: number }) => ProbeSocket;

/** Options for {@link doltSqlHandshakeOk}. */
export interface DoltSqlProbeOptions {
  /** Transport seam — defaults to `net.createConnection` against loopback. */
  connect?: ConnectSeam;
  /** Probe timeout in ms (default {@link DEFAULT_TIMEOUT_MS}). */
  timeoutMs?: number;
}

/**
 * Is `buf` the leading bytes of a valid MySQL Initial Handshake greeting?
 *
 * We only need the first 5 bytes: header[3] + protocol-version[1]. We validate the
 * sequence id is 0 (greeting), the protocol version is 9 or 10, and the declared
 * payload length is plausible.
 */
function looksLikeMysqlGreeting(buf: Buffer): boolean {
  if (buf.length < 5) return false;
  const payloadLen = buf.readUIntLE(0, 3);
  const sequenceId = buf[3];
  const protocolVersion = buf[4];
  if (sequenceId !== 0) return false;
  if (protocolVersion !== MYSQL_PROTOCOL_V10 && protocolVersion !== MYSQL_PROTOCOL_V9) return false;
  if (payloadLen <= 0 || payloadLen > MAX_GREETING_PAYLOAD) return false;
  return true;
}

/** Default transport: a real loopback TCP connection. */
const defaultConnect: ConnectSeam = ({ host, port }) =>
  createConnection({ host, port }) as unknown as ProbeSocket;

/**
 * Probe the pinned port for a REAL Dolt/MySQL server by validating its unsolicited
 * Initial Handshake greeting. Resolves `true` only when a genuine MySQL-protocol
 * greeting arrives; `false` on connection error, timeout, EOF, or non-MySQL bytes
 * (the squatter case the old bare-TCP probe false-passed).
 *
 * Never rejects — always resolves a boolean — so callers can treat it as a plain
 * health predicate.
 */
export function doltSqlHandshakeOk(port: number, options: DoltSqlProbeOptions = {}): Promise<boolean> {
  const connect = options.connect ?? defaultConnect;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let socket: ProbeSocket;

    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* best-effort */
      }
      resolve(ok);
    };

    try {
      socket = connect({ host: "127.0.0.1", port });
    } catch {
      resolve(false);
      return;
    }

    socket.setTimeout(timeoutMs);
    // First inbound chunk should be the server greeting. A real Dolt server sends it
    // proactively; a squatter sends nothing (→ timeout) or non-MySQL bytes (→ false).
    socket.once("data", (chunk?: unknown) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ""), "latin1");
      done(looksLikeMysqlGreeting(buf));
    });
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.once("close", () => done(false));
  });
}
