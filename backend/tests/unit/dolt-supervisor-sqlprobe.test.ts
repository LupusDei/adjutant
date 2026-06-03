/**
 * adj-182.2.1.r3 / adj-182.2.5.1 — SQL-handshake probe (TDD).
 *
 * The backend health-loop probe used a BARE TCP connect: any process listening on
 * the pinned port (a "squatter" — an unrelated service, a half-dead socket, even
 * `nc -l`) would satisfy `socket.once("connect")` and false-pass "Dolt reachable".
 * The self-heal loop would then NOT kickstart, leaving bd wedged against a port
 * that accepts TCP but speaks no SQL.
 *
 * The fix upgrades the probe to a real MySQL-wire handshake check: Dolt's
 * sql-server (MySQL-protocol) sends an Initial Handshake Packet (protocol v10)
 * the instant a client connects. We read that first packet and validate its
 * structure. A bare TCP squatter that never sends a valid v10 handshake fails the
 * probe — so the loop self-heals instead of false-passing.
 *
 * The byte-level validation is extracted as the pure, seam-free
 * `isMysqlHandshakePacket(buf)` so it is unit-testable without a socket. The
 * socket itself stays an injected effect (realSqlProbe is the production seam).
 */
import { describe, it, expect } from "vitest";

import { isMysqlHandshakePacket } from "../../src/services/dolt-supervisor.js";

/**
 * A minimal but structurally-valid MySQL Initial Handshake Packet v10:
 *   [0..2] payload length (3-byte LE) · [3] sequence id (0) · [4] protocol version (0x0a)
 *   then a NUL-terminated server version string + the rest of the handshake body.
 */
function buildHandshakeV10(serverVersion = "8.0.33-dolt"): Buffer {
  const versionBytes = Buffer.from(`${serverVersion}\0`, "ascii");
  // payload = protocol(1) + version(n) + a stub remainder (thread id, scramble, etc.)
  const remainder = Buffer.alloc(40); // arbitrary realistic-length tail
  const payload = Buffer.concat([Buffer.from([0x0a]), versionBytes, remainder]);
  const header = Buffer.alloc(4);
  header.writeUIntLE(payload.length, 0, 3); // 3-byte payload length
  header[3] = 0; // sequence id 0 — the server's first packet
  return Buffer.concat([header, payload]);
}

describe("isMysqlHandshakePacket (adj-182.2.1.r3)", () => {
  it("should accept a structurally-valid MySQL v10 initial handshake packet", () => {
    expect(isMysqlHandshakePacket(buildHandshakeV10())).toBe(true);
  });

  it("should accept a real-looking dolt server greeting with a long version string", () => {
    expect(isMysqlHandshakePacket(buildHandshakeV10("5.7.9-Vitess-dolt-1.2.3"))).toBe(true);
  });

  it("should REJECT a bare TCP squatter sending arbitrary non-protocol bytes", () => {
    // e.g. an HTTP service or `nc` echoing junk — connects fine, no v10 handshake.
    expect(isMysqlHandshakePacket(Buffer.from("GET / HTTP/1.1\r\n\r\n", "ascii"))).toBe(false);
  });

  it("should REJECT an empty / too-short buffer (connect but no data)", () => {
    expect(isMysqlHandshakePacket(Buffer.alloc(0))).toBe(false);
    expect(isMysqlHandshakePacket(Buffer.from([0x00, 0x00]))).toBe(false);
  });

  it("should REJECT a packet whose protocol version byte is not 0x0a", () => {
    const buf = buildHandshakeV10();
    buf[4] = 0x09; // wrong protocol version
    expect(isMysqlHandshakePacket(buf)).toBe(false);
  });

  it("should REJECT a packet whose first-packet sequence id is not 0", () => {
    const buf = buildHandshakeV10();
    buf[3] = 1; // server's first packet must be seq 0
    expect(isMysqlHandshakePacket(buf)).toBe(false);
  });

  it("should REJECT a MySQL ERR packet (0xff) masquerading as a greeting", () => {
    // Some servers reject the connection with an ERR packet (payload starts 0xff)
    // instead of a handshake — that is NOT a healthy reachable SQL server.
    const errPayload = Buffer.concat([Buffer.from([0xff]), Buffer.alloc(10)]);
    const header = Buffer.alloc(4);
    header.writeUIntLE(errPayload.length, 0, 3);
    header[3] = 0;
    expect(isMysqlHandshakePacket(Buffer.concat([header, errPayload]))).toBe(false);
  });

  it("should REJECT a header whose declared payload length is implausibly large", () => {
    // A squatter could send 0x0a at offset 4 by chance; guard the 3-byte length
    // against absurd values so a random byte stream is unlikely to pass.
    const buf = buildHandshakeV10();
    buf.writeUIntLE(0xffffff, 0, 3); // 16MB-1 declared payload — not a handshake
    expect(isMysqlHandshakePacket(buf)).toBe(false);
  });
});
