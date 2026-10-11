// CloudFront Functions (JavaScript runtime 2.0), viewer-request.
//
// Ox Content writes each page as <path>/index.html. A private S3 origin does
// not resolve directories, so this function maps the URL a reader types to the
// object key that exists:
//   /ja/chapters/03-spa/   -> /ja/chapters/03-spa/index.html   (rewrite)
//   /ja/chapters/03-spa    -> 301 /ja/chapters/03-spa/         (one URL per page)
//   /assets/app-1a2b.css   -> unchanged
// Paths that match no object are left for the distribution's 404 response.
// CloudFront looks this function up by name; nothing in the file calls it.
// oxlint-disable-next-line no-unused-vars
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.endsWith("/")) {
    request.uri = uri + "index.html";
    return request;
  }

  var lastSegment = uri.substring(uri.lastIndexOf("/") + 1);
  if (lastSegment.includes(".")) {
    return request;
  }

  var pairs = [];
  for (var key in request.querystring) {
    var entry = request.querystring[key];
    var values = entry.multiValue ? entry.multiValue : [entry];
    for (var i = 0; i < values.length; i++) {
      pairs.push(values[i].value === "" ? key : key + "=" + values[i].value);
    }
  }

  return {
    statusCode: 301,
    statusDescription: "Moved Permanently",
    headers: {
      location: { value: uri + "/" + (pairs.length > 0 ? "?" + pairs.join("&") : "") },
      "cache-control": { value: "public, max-age=3600" },
    },
  };
}
