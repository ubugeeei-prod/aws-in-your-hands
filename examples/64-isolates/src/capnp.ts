import type { Deployment } from "./definition.ts";

type Worker = Deployment["workers"][number];
type Binding = Worker["bindings"][number];
type Socket = Deployment["sockets"][number];

// #region text
/** A Cap'n Proto text literal. The schema allows printable ASCII only, so these two are all that needs escaping. */
export const text = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
// #endregion text

const binding = (item: Binding): string =>
  item.from === "text"
    ? `(name = ${text(item.name)}, text = ${text(item.value)})`
    : `(name = ${text(item.name)}, fromEnvironment = ${text(item.variable)})`;

function worker(item: Worker): string {
  const lines = [
    // `embed` reads the file when workerd parses the configuration, relative to the configuration file.
    `modules = [(name = ${text(item.module)}, esModule = embed ${text(item.module)})],`,
    `compatibilityDate = ${text(item.compatibilityDate)},`,
  ];
  if (item.bindings.length > 0) {
    lines.push("bindings = [", ...item.bindings.map((entry) => `  ${binding(entry)},`), "],");
  }
  return [
    `    (name = ${text(item.name)}, worker = (`,
    ...lines.map((line) => `      ${line}`),
    "    )),",
  ].join("\n");
}

function socket(item: Socket): string {
  const http =
    item.forwardedProtoHeader === undefined
      ? "()"
      : `(forwardedProtoHeader = ${text(item.forwardedProtoHeader)})`;
  return `    (name = ${text(item.name)}, address = ${text(item.address)}, http = ${http}, service = ${text(item.service)}),`;
}

// #region render
/** The configuration file `workerd serve` reads: Cap'n Proto text, with one constant named `config`. */
export function renderConfig(deployment: Deployment): string {
  return [
    'using Workerd = import "/workerd/workerd.capnp";',
    "",
    "const config :Workerd.Config = (",
    "  services = [",
    ...deployment.workers.map(worker),
    "  ],",
    "  sockets = [",
    ...deployment.sockets.map(socket),
    "  ],",
    ");",
    "",
  ].join("\n");
}
// #endregion render
