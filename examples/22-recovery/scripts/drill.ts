// vp run recovery:drill new <name>                    starts reports/drills/<name>.json from the template
// vp run recovery:drill mark <name> <moment> [--at ISO]   records a moment (now, unless --at is given)
// vp run recovery:drill set <name> <count> <number>     records a count
// vp run recovery:drill summary <name>                  prints the record and the times computed from it
//
// Touches nothing but files under reports/, which git ignores.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { type DrillRecord, drillRecordSchema, isCount, isMoment, mark, summarize } from "../src/drill.ts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { at: { type: "string" } } });
const [command, name, field, value] = positionals;

const directory = new URL("../../../reports/drills/", import.meta.url);
const template = new URL("../drill/record.template.json", import.meta.url);
const read = (url: URL): DrillRecord => drillRecordSchema.parse(JSON.parse(readFileSync(url, "utf8")));

try {
  if (command === undefined || name === undefined || !/^[A-Za-z0-9-]+$/.test(name)) {
    throw new Error("usage: drill.ts <new|mark|set|summary> <name> [moment|count] [number] [--at ISO]");
  }
  const file = new URL(`${name}.json`, directory);
  const save = (record: DrillRecord) => writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);

  if (command === "new") {
    if (existsSync(file)) {
      throw new Error(`${file.pathname} already exists. A drill record is not started twice.`);
    }
    mkdirSync(directory, { recursive: true });
    save({ ...read(template), name });
    console.log(`started ${file.pathname}`);
  } else if (command === "mark") {
    const record = read(file);
    if (field === undefined || !isMoment(record, field)) {
      throw new Error(`mark needs one of: ${Object.keys(record.timeline).join(", ")}`);
    }
    const at = values.at === undefined ? new Date() : new Date(values.at);
    if (Number.isNaN(at.getTime())) {
      throw new Error(`--at ${values.at} is not a time.`);
    }
    save(mark(record, field, at));
    console.log(`${field} = ${at.toISOString()}`);
  } else if (command === "set") {
    const record = read(file);
    const number = Number(value);
    if (field === undefined || !isCount(record, field) || !Number.isInteger(number) || number < 0) {
      throw new Error(`set needs one of: ${Object.keys(record.counts).join(", ")}, and a whole number`);
    }
    save({ ...record, counts: { ...record.counts, [field]: number } });
    console.log(`${field} = ${number}`);
  } else if (command === "summary") {
    const record = read(file);
    console.log(JSON.stringify({ record, computed: summarize(record) }, null, 2));
  } else {
    throw new Error(`unknown command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
