import * as v from "valibot";

// Argument lists for `openssl`, and the one extension file a node certificate
// needs. Nothing here runs anything: scripts/certs.ts does.

export const nodeAddressSchema = v.pipe(
  v.string(),
  v.regex(/^(?:\d{1,3}\.){3}\d{1,3}$/, "not an IPv4 address"),
);

// #region names
/** YugabyteDB looks its files up by these names inside `--certs_dir`. */
export const certFiles = (address: string) => ({
  ca: "ca.crt",
  certificate: `node.${address}.crt`,
  key: `node.${address}.key`,
});
// #endregion names

// #region openssl
export const CA_DAYS = 3650;
/** A node certificate is cheap to replace, and replacing it is a rolling restart. */
export const NODE_DAYS = 397;

/** A new private key and a self-signed root. The key signs every node of one cluster and nothing else. */
export const caArgs = (directory: string): string[] => [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-sha256",
  "-days",
  String(CA_DAYS),
  "-subj",
  "/O=AWS in Your Hands/CN=CA for YugabyteDB",
  "-keyout",
  `${directory}/ca.key`,
  "-out",
  `${directory}/ca.crt`,
];

/** Runs where the node's key is to live. Only the request leaves that machine. */
export function requestArgs(directory: string, address: string): string[] {
  const files = certFiles(v.parse(nodeAddressSchema, address));
  return [
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    // The documentation requires the common name to be the node's address.
    "-subj",
    `/O=AWS in Your Hands/CN=${address}`,
    "-keyout",
    `${directory}/${files.key}`,
    "-out",
    `${directory}/node.csr`,
  ];
}

/** What the CA adds when it signs: the address as a subject alternative name, which clients check. */
export const extensionsFor = (address: string): string =>
  [
    "basicConstraints=critical,CA:false",
    "keyUsage=critical,digitalSignature,keyEncipherment",
    "extendedKeyUsage=serverAuth,clientAuth",
    `subjectAltName=IP:${v.parse(nodeAddressSchema, address)}`,
    "",
  ].join("\n");

export function signArgs(input: {
  caDirectory: string;
  request: string;
  extensions: string;
  out: string;
}): string[] {
  return [
    "x509",
    "-req",
    "-sha256",
    "-days",
    String(NODE_DAYS),
    "-in",
    input.request,
    "-CA",
    `${input.caDirectory}/ca.crt`,
    "-CAkey",
    `${input.caDirectory}/ca.key`,
    "-CAcreateserial",
    "-extfile",
    input.extensions,
    "-out",
    input.out,
  ];
}
// #endregion openssl
