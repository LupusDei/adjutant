/**
 * Tests for the real Dolt SQL-handshake probe (adj-182.2.1.r3 / adj-182.2.2.1).
 *
 * The OLD probe was a bare TCP connect: it resolved `true` the instant ANY process
 * accepted the socket. A rogue/squatter listening on the pinned port (or any unrelated
 * service) would therefore false-pass verification (`verified:true`) even though it is
 * NOT a Dolt server — the exact false-positive that lets a first-install bootstrap a
 * SECOND server on a data-dir already owned by a rogue (#2670 / adj-182.2.2.1).
 *
 * The NEW probe performs a real MySQL/Dolt protocol handshake check: after the TCP
 * connect it waits for the server's Initial Handshake Packet (the greeting Dolt's
 * sql-server sends immediately on connect) and validates it is a genuine MySQL-protocol
 * packet (sequence id 0, protocol version 9 or 10, sane payload length). A bare-TCP
 * squatter that never speaks MySQL fails the probe.
 *
 * The transport is INJECTED (a connect seam yielding a fake duplex-ish socket) so this
 * test never opens a real socket and never touches the live Dolt server.
 */

import { describe, it, expect, vi } from "vitest";

import { doltSqlHandshakeOk, type ProbeSocket, type ConnectSeam } from "../../../cli/lib/dolt-sql-probe.js";

/**
 * A scriptable fake socket. Tests push the bytes (or events) the "server" emits; the
 * probe reads them via the `data`/`connect`/`error`/`timeout`/`close` listeners.
 */
function makeFakeSocket(): ProbeSocket & {
  emitConnect: () => void;
  emitData: (buf: Buffer) => void;
  emitError: () => void;
  emitTimeout: () => void;
  destroyed: boolean;
} {
  const listeners: Record<string, ((arg?: unknown) => void)[]> = {};
  const on = (ev: string, cb: (arg?: unknown) => void): void => {
    (listeners[ev] ??= []).push(cb);
  };
  const fire = (ev: string, arg?: unknown): void => {
    for (const cb of listeners[ev] ?? []) cb(arg);
  };
  const sock = {
    destroyed: false,
    once: on,
    on,
    setTimeout: vi.fn(),
    write: vi.fn(),
    destroy: vi.fn(function (this: { destroyed: boolean }) {
      sock.destroyed = true;
    }),
    emitConnect: (): void => {
      fire("connect");
    },
    emitData: (buf: Buffer): void => {
      fire("data", buf);
    },
    emitError: (): void => {
      fire("error", new Error("ECONNREFUSED"));
    },
    emitTimeout: (): void => {
      fire("timeout");
    },
  };
  return sock as unknown as ProbeSocket & {
    emitConnect: () => void;
    emitData: (buf: Buffer) => void;
    emitError: () => void;
    emitTimeout: () => void;
    destroyed: boolean;
  };
}

/** A real MySQL/Dolt Initial Handshake Packet (greeting) head: len(3) + seq(1)=0 + protoVer(1)=10. */
function mysqlGreeting(protocolVersion = 10): Buffer {
  // payload: protocolVersion byte + a null-terminated version string + filler.
  const versionStr = Buffer.from("8.0.33-dolt\0", "latin1");
  const payload = Buffer.concat([Buffer.from([protocolVersion]), versionStr]);
  const head = Buffer.alloc(4);
  head.writeUIntLE(payload.length, 0, 3); // 3-byte little-endian length
  head[3] = 0; // sequence id 0 for the greeting
  return Buffer.concat([head, payload]);
}

describe("doltSqlHandshakeOk", () => {
  it("should resolve true when the server emits a valid MySQL handshake greeting", async () => {
    const sock = makeFakeSocket();
    const connect: ConnectSeam = () => sock;
    const p = doltSqlHandshakeOk(17005, { connect });
    sock.emitConnect();
    sock.emitData(mysqlGreeting(10));
    expect(await p).toBe(true);
  });

  it("should accept the legacy protocol version 9 greeting", async () => {
    const sock = makeFakeSocket();
    const p = doltSqlHandshakeOk(17005, { connect: () => sock });
    sock.emitConnect();
    sock.emitData(mysqlGreeting(9));
    expect(await p).toBe(true);
  });

  it("should resolve false for a bare-TCP squatter that connects but never sends a MySQL greeting", async () => {
    // The squatter accepts the socket (connect fires) but sends garbage / nothing
    // resembling a MySQL packet. The OLD bare-TCP probe would have returned true here.
    const sock = makeFakeSocket();
    const p = doltSqlHandshakeOk(17005, { connect: () => sock, timeoutMs: 50 });
    sock.emitConnect();
    sock.emitData(Buffer.from("HTTP/1.1 200 OK\r\n\r\n", "latin1"));
    expect(await p).toBe(false);
  });

  it("should resolve false when the connection errors (no server listening)", async () => {
    const sock = makeFakeSocket();
    const p = doltSqlHandshakeOk(17005, { connect: () => sock });
    sock.emitError();
    expect(await p).toBe(false);
  });

  it("should resolve false on timeout when the server accepts but stays silent", async () => {
    const sock = makeFakeSocket();
    const p = doltSqlHandshakeOk(17005, { connect: () => sock });
    sock.emitConnect();
    sock.emitTimeout();
    expect(await p).toBe(false);
  });

  it("should destroy the socket after resolving (no leaked connection)", async () => {
    const sock = makeFakeSocket();
    const p = doltSqlHandshakeOk(17005, { connect: () => sock });
    sock.emitConnect();
    sock.emitData(mysqlGreeting(10));
    await p;
    expect(sock.destroyed).toBe(true);
  });

  it("should connect to loopback on the given port", async () => {
    const connect = vi.fn(() => {
      const s = makeFakeSocket();
      queueMicrotask(() => {
        s.emitConnect();
        s.emitData(mysqlGreeting(10));
      });
      return s;
    });
    await doltSqlHandshakeOk(17042, { connect });
    expect(connect).toHaveBeenCalledWith({ host: "127.0.0.1", port: 17042 });
  });

  it("should reject a packet whose sequence id is not 0 (not a greeting)", async () => {
    const sock = makeFakeSocket();
    const p = doltSqlHandshakeOk(17005, { connect: () => sock, timeoutMs: 50 });
    sock.emitConnect();
    const g = mysqlGreeting(10);
    g[3] = 7; // wrong sequence id — not the initial greeting
    sock.emitData(g);
    expect(await p).toBe(false);
  });
});
