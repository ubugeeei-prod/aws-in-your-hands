// Paths without a file extension are client-side routes: answer with index.html.
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
