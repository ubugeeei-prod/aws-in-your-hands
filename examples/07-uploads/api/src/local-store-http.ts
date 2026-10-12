import { MAX_UPLOAD_BYTES } from "./contract.ts";
import type { InMemoryObjectStore } from "./memory-object-store.ts";

export const LOCAL_STORE_PATH = "/local/s3";

// A little above the limit, so that an oversized image reaches the store's own check.
const MAX_FORM_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

// #region read-form
// Chapter 04's readJson bounds a JSON body. This does the same for a form with a file in it:
// count while reading, and stop at the limit instead of holding the rest in memory.
async function readForm(request: Request, maxBytes: number): Promise<FormData | "too_large"> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) {
    return "too_large";
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body !== null) {
    for await (const chunk of request.body) {
      size += chunk.byteLength;
      if (size > maxBytes) {
        return "too_large";
      }
      chunks.push(chunk);
    }
  }
  // The boundary between the fields is in the Content-Type header, so it goes along.
  return new Response(Buffer.concat(chunks), {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  }).formData();
}
// #endregion read-form

// #region local-store
/** The in-memory store behind HTTP, for the development server and the tests. */
export function createLocalStoreHandler(objects: InMemoryObjectStore) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    // Where the browser sends the form. Like S3, it looks at no access token:
    // the signed fields in the form are the whole permission.
    if (request.method === "POST" && url.pathname === LOCAL_STORE_PATH) {
      const form = await readForm(request, MAX_FORM_BYTES);
      if (form === "too_large") {
        return new Response("too large", { status: 413 });
      }
      const fields: Record<string, string> = {};
      let file: File | undefined;
      for (const [name, value] of form.entries()) {
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
