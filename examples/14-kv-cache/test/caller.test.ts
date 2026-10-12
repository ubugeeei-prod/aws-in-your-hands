import { describe, expect, it } from "vite-plus/test";

import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";

import { type Caller, rateSubject, sourceAddressOf, UNKNOWN_CALLER } from "../src/caller.ts";

describe("sourceAddressOf", () => {
  it("reads the address API Gateway recorded in the event", () => {
    expect(sourceAddressOf({ requestContext: { http: { sourceIp: "203.0.113.7" } } })).toBe(
      "203.0.113.7",
    );
  });

  it("reads the socket's peer on the development server, whatever the headers claim", async () => {
    const app = (_request: Request, caller: Caller) => Response.json(caller);
    // Wired as src/dev.ts wires the real app.
    const server = nodeServer((request, { remoteAddress }) =>
      app(request, { sourceAddress: remoteAddress }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { "x-forwarded-for": "198.51.100.1" },
      });
      expect(await response.json()).toEqual({ sourceAddress: "127.0.0.1" });
    } finally {
      server.close();
    }
  });

  it("finds nothing where the platform put nothing", () => {
    expect(sourceAddressOf(undefined)).toBeUndefined();
    expect(sourceAddressOf({})).toBeUndefined();
    expect(sourceAddressOf({ requestContext: { http: {} } })).toBeUndefined();
  });
});

describe("rateSubject", () => {
  it("counts an IPv4 address as itself, also when Node reports it mapped into IPv6", () => {
    expect(rateSubject("203.0.113.7")).toBe("ip4-203.0.113.7");
    expect(rateSubject("::ffff:203.0.113.7")).toBe("ip4-203.0.113.7");
  });

  it("counts a whole IPv6 /64 as one caller, however the address is written", () => {
    const subject = rateSubject("2001:db8:12:3400::1");
    expect(subject).toBe("ip6-2001:db8:12:3400");
    // Another address in the same network: the same budget.
    expect(rateSubject("2001:db8:12:3400:ffff:ffff:ffff:ffff")).toBe(subject);
    expect(rateSubject("2001:0DB8:0012:3400:0:0:0:2")).toBe(subject);
    // The neighbouring network is someone else.
    expect(rateSubject("2001:db8:12:3401::1")).not.toBe(subject);
    expect(rateSubject("::1")).toBe("ip6-0:0:0:0");
  });

  it("gives everything it cannot read the same subject, so garbage never earns a fresh budget", () => {
    for (const address of [undefined, "", "alice", "203.0.113.999", "203.0.113.7, 198.51.100.1"]) {
      expect(rateSubject(address)).toBe(UNKNOWN_CALLER);
    }
  });
});
