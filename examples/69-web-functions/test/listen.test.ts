import { describe, expect, it } from "vite-plus/test";

import { listenAddress } from "../src/listen.ts";

describe("where the server listens", () => {
  it("takes the host and the port from AWS_LAMBDA_HTTP_ENDPOINT", () => {
    expect(listenAddress({ AWS_LAMBDA_HTTP_ENDPOINT: "127.0.0.1:9001" })).toEqual({
      host: "127.0.0.1",
      port: 9001,
    });
    expect(listenAddress({ AWS_LAMBDA_HTTP_ENDPOINT: "localhost:3000" })).toEqual({
      host: "localhost",
      port: 3000,
    });
  });

  it("falls back to a loopback address only when the variable is not set", () => {
    expect(listenAddress({})).toEqual({ host: "127.0.0.1", port: 8787 });
  });

  it("stops on a value it cannot read, instead of listening where no request arrives", () => {
    for (const value of ["", "3000", "localhost", "localhost:", ":3000", "localhost:http"]) {
      expect(() => listenAddress({ AWS_LAMBDA_HTTP_ENDPOINT: value }), value).toThrow(
        /AWS_LAMBDA_HTTP_ENDPOINT/,
      );
    }
  });

  it("refuses a port no socket can have", () => {
    for (const value of ["localhost:0", "localhost:65536", "localhost:99999"]) {
      expect(() => listenAddress({ AWS_LAMBDA_HTTP_ENDPOINT: value }), value).toThrow(/port/);
    }
  });

  it("ignores PORT: that is another platform's contract", () => {
    expect(listenAddress({ PORT: "5000" })).toEqual({ host: "127.0.0.1", port: 8787 });
  });
});
