import { describe, expect, it } from "vitest";

import { nodeClientIp } from "./node-client-ip.js";

describe("Node public sandbox client-IP adapter", () => {
  it("uses only the transport peer address and normalizes IPv4-mapped sockets", () => {
    expect(
      nodeClientIp({
        incoming: { socket: { remoteAddress: "::ffff:203.0.113.28" } },
      }),
    ).toBe("203.0.113.28");
    expect(
      nodeClientIp({
        incoming: { socket: { remoteAddress: "2001:DB8::1" } },
      }),
    ).toBe("2001:db8::1");
  });

  it("does not accept an unverified forwarded header as a quota identity", () => {
    // A forwarding header is not a Node transport binding and cannot become a
    // quota identity inside the adapter.
    expect(
      nodeClientIp({
        headers: new Headers({ "X-Forwarded-For": "203.0.113.28" }),
      }),
    ).toBeUndefined();
  });
});
