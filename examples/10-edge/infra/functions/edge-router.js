import cf from "cloudfront";

// #region kvs
// A function has at most one store, so no ID is needed.
const kvs = cf.kvs();

// get() rejects for a missing key and for a failed read alike. Both mean "no rule": the site keeps serving.
async function read(key) {
  try {
    return await kvs.get(key);
    // The binding stays: `catch {}` is not on the runtime 2.0 list.
    // oxlint-disable-next-line no-unused-vars
  } catch (error) {
    return null;
  }
}
// #endregion kvs

const REDIRECTS = {
  301: "Moved Permanently",
  302: "Found",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
};
// Longer paths are not looked up: a key may be 512 bytes at most.
const MAX_REDIRECT_PATH = 256;

// #region maintenance
function maintenance() {
  return {
    statusCode: 503,
    statusDescription: "Service Unavailable",
    headers: {
      "content-type": { value: "text/html; charset=utf-8" },
      "cache-control": { value: "no-store" },
      "retry-after": { value: "120" },
    },
    body: {
      encoding: "text",
      data: '<!doctype html><html lang="en"><meta charset="utf-8"><title>Back soon</title><h1>Back soon</h1><p>This site is under maintenance. Please try again in a few minutes.</p></html>',
    },
  };
}
// #endregion maintenance

// #region digest
// The one path that runs Lambda@Edge, which bills per request. Anything but a POST stops here.
const DIGEST_PATH = "/digest";

function methodNotAllowed() {
  return {
    statusCode: 405,
    statusDescription: "Method Not Allowed",
    headers: {
      allow: { value: "POST" },
      "cache-control": { value: "no-store" },
    },
  };
}
// #endregion digest

// #region redirect
// The store can be edited from the console, so the value is checked again here.
function parseRedirect(raw, uri) {
  let rule;
  try {
    rule = JSON.parse(raw);
    // The binding stays: `catch {}` is not on the runtime 2.0 list.
    // oxlint-disable-next-line no-unused-vars
  } catch (error) {
    return null;
  }
  if (rule === null || typeof rule !== "object" || typeof rule.to !== "string") {
    return null;
  }
  const to = rule.to;
  // Same-site paths only. "//host" and "/\host" would send the reader to another site.
  if (!to.startsWith("/") || to.startsWith("//") || to.includes("\\") || to === uri) {
    return null;
  }
  if (
    typeof rule.status !== "number" ||
    !Object.prototype.hasOwnProperty.call(REDIRECTS, rule.status)
  ) {
    return null;
  }
  return { to, status: rule.status };
}

function queryString(querystring) {
  const pairs = [];
  let key;
  for (key in querystring) {
    const entry = querystring[key];
    const values = entry.multiValue ? entry.multiValue : [entry];
    for (let i = 0; i < values.length; i++) {
      pairs.push(values[i].value === "" ? key : `${key}=${values[i].value}`);
    }
  }
  return pairs.length > 0 ? `?${pairs.join("&")}` : "";
}

function redirect(rule, querystring) {
  return {
    statusCode: rule.status,
    statusDescription: REDIRECTS[rule.status],
    headers: {
      location: { value: rule.to + (rule.to.includes("?") ? "" : queryString(querystring)) },
      // Browsers keep a 301 with no lifetime for good. This keeps a mistake fixable.
      "cache-control": { value: "public, max-age=300" },
    },
  };
}
// #endregion redirect

// #region handler
// CloudFront calls handler by name; nothing in this file does.
// oxlint-disable-next-line no-unused-vars
async function handler(event) {
  const request = event.request;
  const uri = request.uri;

  // Before the store is read: a refusal should cost as little as it can.
  if (uri === DIGEST_PATH && request.method !== "POST") {
    return methodNotAllowed();
  }

  if ((await read("flag:maintenance")) === "on") {
    return maintenance();
  }

  const lastSegment = uri.substring(uri.lastIndexOf("/") + 1);
  // Files are never redirected, which saves one read on every asset.
  if (!lastSegment.includes(".") && uri.length <= MAX_REDIRECT_PATH) {
    const raw = await read(`redirect:${uri}`);
    const rule = raw === null ? null : parseRedirect(raw, uri);
    if (rule !== null) {
      return redirect(rule, request.querystring);
    }
  }

  if (uri === "/") {
    request.uri = (await read("flag:new-home")) === "on" ? "/home-v2.html" : "/index.html";
  } else if (uri.endsWith("/")) {
    request.uri = `${uri}index.html`;
  }
  return request;
}
// #endregion handler
