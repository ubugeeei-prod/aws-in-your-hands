// Where a client with no `credentials` setting would get its credentials on this machine.
// Prints the last four characters of the key ID and nothing else of it.
import { reportDefaultCredentials } from "../src/credentials.ts";

try {
  console.log(JSON.stringify(await reportDefaultCredentials(), null, 2));
} catch (error) {
  // The chain's last link: no provider had anything.
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
}
