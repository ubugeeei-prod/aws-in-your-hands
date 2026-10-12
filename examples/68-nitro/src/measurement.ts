import { createHash } from "node:crypto";

// #region measurement
/** A PCR is a SHA-384 digest: 48 bytes, written as 96 hexadecimal characters. */
export const PCR_BYTES = 48;

/** What every PCR reads in an enclave started with --debug-mode or --attach-console. */
export const DEBUG_PCR = "0".repeat(PCR_BYTES * 2);

/** A value worth putting in a key policy: the right length, and not the debug value. */
export const isMeasurement = (value: string): boolean =>
  /^[0-9a-f]{96}$/.test(value) && value !== DEBUG_PCR;

/**
 * PCR3 (from the parent's IAM role ARN) and PCR4 (from its instance ID), as the
 * Nitro Enclaves guide computes them: SHA-384 over 48 zero bytes followed by the text.
 */
export const pcrOfText = (text: string): string =>
  createHash("sha384").update(new Uint8Array(PCR_BYTES)).update(text, "utf8").digest("hex");
// #endregion measurement
