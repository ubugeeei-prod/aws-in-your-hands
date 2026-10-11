import type { InMemoryObjectStore } from "./memory-object-store.ts";

export const LOCAL_STORE_PATH = "/local/s3";

// #region local-store
/** The in-memory store behind HTTP, for the development server and the tests. */
export function createLocalStoreHandler(objects: InMemoryObjectStore) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    // Where the browser sends the form. Like S3, it looks at no access token:
    // the signed fields in the form are the whole permission.
    if (request.method === "POST" && url.pathname === LOCAL_STORE_PATH) {
      const fields: Record<string, string> = {};
      let file: File | undefined;
      for (const [name, value] of (await request.formData()).entries()) {
        if (typeof value === "string") {
          fields[name] = value;
        } else if (name === "file") {
          file = value;
        }
      }
      if (file === undefined) {
        return new Response("no file field", { status: 400 });
      }
      const received = objects.receive(fields, new Uint8Array(await file.arrayBuffer()));
      return received.ok
        ? new Response(null, { status: 204 })
        : new Response(received.reason, { status: received.reason === "size" ? 400 : 403 });
    }

    // Where a view URL points. No access token here either.
    if (request.method === "GET" && url.pathname.startsWith(`${LOCAL_STORE_PATH}/`)) {
      const key = decodeURIComponent(url.pathname.slice(LOCAL_STORE_PATH.length + 1));
      const object = objects.read(
        key,
        url.searchParams.get("expires") ?? undefined,
        url.searchParams.get("signature") ?? undefined,
      );
      return object === undefined
        ? new Response("AccessDenied", { status: 403 })
        : new Response(new Uint8Array(object.body), {
            status: 200,
            headers: { "content-type": object.contentType, "x-content-type-options": "nosniff" },
          });
    }

    return new Response("not found", { status: 404 });
  };
}
// #endregion local-store
