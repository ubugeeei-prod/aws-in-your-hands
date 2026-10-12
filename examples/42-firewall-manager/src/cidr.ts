// #region cidr
export type Cidr = { family: 4 | 6; value: bigint; prefix: number };

const BITS = { 4: 32, 6: 128 } as const;

function parseIpv4(address: string): bigint | undefined {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
    return undefined;
  }
  return parts.reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}

function parseIpv6(address: string): bigint | undefined {
  const halves = address.split("::");
  if (halves.length > 2) {
    return undefined;
  }
  const groups = (half: string) => (half === "" ? [] : half.split(":"));
  const head = groups(halves[0] ?? "");
  const tail = groups(halves[1] ?? "");
  const missing = 8 - head.length - tail.length;
  // Without "::" all eight groups are written; with it, at least one is left out.
  if (halves.length === 1 ? missing !== 0 : missing < 1) {
    return undefined;
  }
  const all = [...head, ...Array.from({ length: missing }, () => "0"), ...tail];
  // An IPv4 address in the last 32 bits is not read: the caller reports the rule as not evaluated.
  if (all.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) {
    return undefined;
  }
  return all.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

/** `undefined` for anything that is not plain CIDR notation. Host bits are masked off. */
export function parseCidr(text: string): Cidr | undefined {
  const match = /^([0-9a-f:.]+)\/(\d{1,3})$/i.exec(text);
  if (match === null) {
    return undefined;
  }
  const [, address = "", length = ""] = match;
  const family = address.includes(":") ? 6 : 4;
  const value = family === 4 ? parseIpv4(address) : parseIpv6(address);
  const prefix = Number(length);
  if (value === undefined || prefix > BITS[family]) {
    return undefined;
  }
  const hostBits = BigInt(BITS[family] - prefix);
  return { family, value: (value >> hostBits) << hostBits, prefix };
}

/** Every address of `inner` is an address of `outer`. */
export function contains(outer: Cidr, inner: Cidr): boolean {
  if (outer.family !== inner.family || inner.prefix < outer.prefix) {
    return false;
  }
  const hostBits = BigInt(BITS[outer.family] - outer.prefix);
  return inner.value >> hostBits === outer.value >> hostBits;
}
// #endregion cidr
