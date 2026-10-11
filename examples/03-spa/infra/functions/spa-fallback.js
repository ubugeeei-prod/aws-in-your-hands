// Paths without an extension belong to the client-side router. Files pass through, so a missing one is a 404.
// CloudFront calls handler by name; nothing in this file does.
// oxlint-disable-next-line no-unused-vars
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var lastSegment = uri.substring(uri.lastIndexOf("/") + 1);

  if (!lastSegment.includes(".")) {
    request.uri = "/index.html";
  }
  return request;
}
