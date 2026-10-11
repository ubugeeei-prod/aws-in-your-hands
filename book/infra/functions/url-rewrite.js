// A private S3 origin does not resolve directories: /dir/ becomes /dir/index.html, /dir redirects to /dir/.
// CloudFront calls handler by name; nothing in this file does.
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
