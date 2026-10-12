// What the installed SDK does when nothing is configured, read from the SDK itself.
// Local only: the one request each client sends goes to an endpoint this script starts.
import { readSdkDefaults } from "../src/defaults.ts";

console.log(JSON.stringify(await readSdkDefaults(), null, 2));
