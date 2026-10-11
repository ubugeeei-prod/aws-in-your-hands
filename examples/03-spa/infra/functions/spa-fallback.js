// CloudFront Functions (JavaScript runtime 2.0), viewer-request.
//
// The SPA has exactly one HTML document. Paths such as /notes/abc exist only
// in the client-side router, so they are answered with index.html. Anything
// that looks like a file (it has an extension) is passed through unchanged,
// which lets a missing script or image fail with a 404 instead of receiving
// HTML.
// CloudFront looks this function up by name; nothing in the file calls it.
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
