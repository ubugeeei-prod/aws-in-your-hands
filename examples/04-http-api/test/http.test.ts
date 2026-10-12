import type { AddressInfo } from "node:net";

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vite-plus/test";

import { handleApiGateway, toRequest, toResult } from "../src/http/api-gateway.ts";
import { readJson } from "../src/http/body.ts";
import { cors } from "../src/http/cors.ts";
import { nodeServer } from "../src/http/node-server.ts";
import { route, router } from "../src/http/router.ts";

const get = (path: string, init?: RequestInit) => new Request(`http://api.test${path}`, init);

describe("router", () => {
  const routes = router<undefined>(
    [
      route("GET", "/notes", () => new Response("list")),
      route("GET", "/notes/:id", (_request, _context, { id }) => new Response(`note ${id}`)),
      route("DELETE", "/notes/:id", () => new Response(null, { status: 204 })),
    ],
    () => new Response("nothing", { status: 404 }),
  );
  const text = async (request: Request) => (await routes(request, undefined)).text();

  it("picks the route by method and path, and names the parts of the path", async () => {
    expect(await text(get("/notes"))).toBe("list");
    expect(await text(get("/notes/abc?x=1"))).toBe("note abc");
    expect((await routes(get("/notes/abc", { method: "DELETE" }), undefined)).status).toBe(204);
  });

  it("decodes a part of the path, and treats one that cannot be decoded as no route", async () => {
    expect(await text(get("/notes/a%20b"))).toBe("note a b");
    expect((await routes(get("/notes/%zz"), undefined)).status).toBe(404);
  });

  it("answers not found for an unknown path, a longer path, and a method no route takes", async () => {
    for (const request of [get("/nope"), get("/notes/a/b"), get("/notes", { method: "PUT" })]) {
      expect((await routes(request, undefined)).status).toBe(404);
    }
  });
});

describe("cors", () => {
  const options = {
    origin: "https://app.example",
    allowMethods: ["GET", "POST"],
    allowHeaders: ["content-type"],
  };
  const handler = cors<undefined>(
    options,
    () => new Response("ok", { headers: { vary: "Accept" } }),
  );

  it("answers a preflight itself, without calling the route", async () => {
    const response = await handler(get("/notes", { method: "OPTIONS" }), undefined);
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toBe("GET,POST");
    expect(response.headers.get("access-control-allow-headers")).toBe("content-type");
  });

  it("names the one allowed origin on every answer, and keeps the headers the route set", async () => {
    const response = await handler(
      get("/notes", { headers: { origin: "https://evil.example" } }),
      undefined,
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(response.headers.get("vary")).toBe("Accept, Origin");
    expect(await response.text()).toBe("ok");
  });
});

describe("readJson", () => {
  const post = (body: BodyInit, headers: Record<string, string> = {}) =>
    get("/", { method: "POST", body, headers, duplex: "half" } as RequestInit);

  it("reads a body within the limit", async () => {
    expect(await readJson(post('{"a":1}'), 16)).toEqual({ ok: true, value: { a: 1 } });
  });

  it("refuses by the declared length without reading", async () => {
    const request = post("{}", { "content-length": "999" });
    expect(await readJson(request, 16)).toEqual({ ok: false, reason: "too_large" });
    expect(request.bodyUsed).toBe(false);
  });

  it("refuses a stream that declares no length once it passes the limit", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('"'.padEnd(10, "x")));
        controller.enqueue(new TextEncoder().encode("x".repeat(10)));
        controller.close();
      },
    });
    expect(await readJson(post(stream), 16)).toEqual({ ok: false, reason: "too_large" });
  });

  it("says so when the body is not JSON, is empty, or is not UTF-8", async () => {
    for (const body of ["{not json", "", new Uint8Array([0xff, 0xfe])]) {
      expect(await readJson(post(body), 16)).toEqual({ ok: false, reason: "invalid_json" });
    }
  });
});

const event = (overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 =>
  ({
    version: "2.0",
    routeKey: "POST /notes",
    rawPath: "/notes/a%20b",
    rawQueryString: "limit=2&tag=x",
    headers: { "content-type": "application/json", accept: "a/b,c/d" },
    requestContext: {
      domainName: "abc.execute-api.ap-northeast-1.amazonaws.com",
      http: {
        method: "POST",
        path: "/notes/a b",
        protocol: "HTTP/1.1",
        sourceIp: "",
        userAgent: "",
      },
    },
    body: '{"title":"t"}',
    isBase64Encoded: false,
    ...overrides,
  }) as APIGatewayProxyEventV2;

describe("API Gateway event to Request", () => {
  it("keeps the method, the path as sent, the query, the headers, and the body", async () => {
    const request = toRequest(event());
    expect(request.method).toBe("POST");
    expect(request.url).toBe(
      "https://abc.execute-api.ap-northeast-1.amazonaws.com/notes/a%20b?limit=2&tag=x",
    );
    expect(request.headers.get("accept")).toBe("a/b,c/d");
    expect(await request.json()).toEqual({ title: "t" });
  });

  it("puts the cookies back in one header, and decodes a base64 body", async () => {
    const request = toRequest(
      event({
        cookies: ["a=1", "b=2"],
        body: Buffer.from("héllo").toString("base64"),
        isBase64Encoded: true,
      }),
    );
    expect(request.headers.get("cookie")).toBe("a=1; b=2");
    expect(await request.text()).toBe("héllo");
  });

  it("gives a GET no body", () => {
    const get = event({ body: undefined });
    get.requestContext.http.method = "GET";
    expect(toRequest(get).body).toBeNull();
  });
});

describe("Response to API Gateway result", () => {
  it("sends text as text, and each cookie on its own", async () => {
    const headers = new Headers({ "content-type": "application/json", "x-request-id": "r1" });
    headers.append("set-cookie", "a=1; Path=/");
    headers.append("set-cookie", "b=2; Path=/");
    expect(await toResult(new Response('{"ok":true}', { status: 201, headers }))).toEqual({
      statusCode: 201,
      headers: { "content-type": "application/json", "x-request-id": "r1" },
      cookies: ["a=1; Path=/", "b=2; Path=/"],
      body: '{"ok":true}',
      isBase64Encoded: false,
    });
  });

  it("sends bytes as base64, and an empty answer as an empty string", async () => {
    const image = await toResult(
      new Response(new Uint8Array([0, 255, 16]), { headers: { "content-type": "image/png" } }),
    );
    expect(image).toMatchObject({ body: "AP8Q", isBase64Encoded: true });
    expect(await toResult(new Response(null, { status: 204 }))).toMatchObject({
      statusCode: 204,
      body: "",
    });
  });

  it("gives the handler the event, for what a Request cannot carry", async () => {
    const handler = handleApiGateway((request, { event: seen }) =>
      Response.json({ route: seen.routeKey, path: new URL(request.url).pathname }),
    );
    expect(JSON.parse((await handler(event())).body ?? "")).toEqual({
      route: "POST /notes",
      path: "/notes/a%20b",
    });
  });
});

describe("node server", () => {
  const listen = async (handler: Parameters<typeof nodeServer>[0]) => {
    const server = nodeServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return {
      url: `http://127.0.0.1:${port}`,
      close: () => new Promise((resolve) => server.close(resolve)),
    };
  };

  it("carries a request in and a response out, with every header and cookie", async () => {
    const { url, close } = await listen(async (request) => {
      const headers = new Headers({
        "x-method": request.method,
        "x-path": new URL(request.url).pathname,
      });
      headers.append("set-cookie", "a=1");
      headers.append("set-cookie", "b=2");
      return new Response(`got ${await request.text()}`, { status: 201, headers });
    });
    const response = await fetch(`${url}/notes?x=1`, { method: "POST", body: "hello" });
    expect(response.status).toBe(201);
    expect(response.headers.get("x-method")).toBe("POST");
    expect(response.headers.get("x-path")).toBe("/notes");
    expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(await response.text()).toBe("got hello");
    await close();
  });

  it("tells the handler who is on the other end of the socket, whatever the headers claim", async () => {
    const { url, close } = await listen(
      (_request, { remoteAddress }) => new Response(remoteAddress),
    );
    const response = await fetch(url, { headers: { "x-forwarded-for": "203.0.113.9" } });
    expect(await response.text()).toBe("127.0.0.1");
    await close();
  });

  it("sends a streamed response as it is written, not when it ends", async () => {
    let finish = (): void => {};
    const { url, close } = await listen(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("first\n"));
              finish = () => controller.close();
            },
          }),
        ),
    );
    const reader = (await fetch(url)).body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toBe("first\n");
    finish();
    expect((await reader?.read())?.done).toBe(true);
    await close();
  });

  it("aborts the request's signal and cancels the body when the caller goes away mid-answer", async () => {
    const seen = { aborted: false, cancelled: false };
    let settle = (): void => {};
    const both = new Promise<void>((resolve) => (settle = resolve));
    const { url, close } = await listen((request) => {
      request.signal.addEventListener("abort", () => {
        seen.aborted = true;
      });
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("first\n"));
          },
          cancel() {
            seen.cancelled = true;
            settle();
          },
        }),
      );
    });
    const caller = new AbortController();
    const reader = (await fetch(url, { signal: caller.signal })).body?.getReader();
    await reader?.read();
    caller.abort();
    await both;
    expect(seen).toEqual({ aborted: true, cancelled: true });
    await close();
  });

  it("answers 500 when the handler throws", async () => {
    const { url, close } = await listen(() => {
      throw new Error("boom");
    });
    expect((await fetch(url)).status).toBe(500);
    await close();
  });
});
