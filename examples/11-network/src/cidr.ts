// IPv4 CIDR arithmetic on plain numbers. No AWS, no I/O.

// #region cidr
export type Cidr = {
  /** Network address as an unsigned 32-bit integer. */
  network: number;
  /** Prefix length, 0 to 32. */
  prefix: number;
};

const OCTET = /^(0|[1-9]\d{0,2})$/;

export function parseIpv4(text: string): number {
  const octets = text.split(".");
  if (octets.length !== 4 || !octets.every((octet) => OCTET.test(octet) && Number(octet) <= 255)) {
    throw new Error(`"${text}" is not an IPv4 address`);
  }
  // Multiplication, not <<: bit shifts in JavaScript are signed 32-bit.
  return octets.reduce((value, octet) => value * 256 + Number(octet), 0);
}

export function formatIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join(".");
}

export const sizeOf = (cidr: Cidr): number => 2 ** (32 - cidr.prefix);
export const lastAddress = (cidr: Cidr): number => cidr.network + sizeOf(cidr) - 1;
export const formatCidr = (cidr: Cidr): string => `${formatIpv4(cidr.network)}/${cidr.prefix}`;

export function parseCidr(text: string): Cidr {
  const [address, prefixText, ...rest] = text.split("/");
  if (address === undefined || prefixText === undefined || rest.length > 0 || !/^\d{1,2}$/.test(prefixText)) {
    throw new Error(`"${text}" is not a CIDR block such as 10.20.0.0/16`);
  }
  const cidr = { network: parseIpv4(address), prefix: Number(prefixText) };
  if (cidr.prefix > 32) {
    throw new Error(`"${text}" has a prefix longer than /32`);
  }
  // 10.20.1.0/16 names the same block as 10.20.0.0/16. EC2 rejects it; so does this.
  if (cidr.network % sizeOf(cidr) !== 0) {
    throw new Error(`"${text}" has host bits set; did you mean ${formatCidr(alignTo(cidr.network, cidr.prefix))}?`);
  }
  return cidr;
}

function alignTo(address: number, prefix: number): Cidr {
  const size = 2 ** (32 - prefix);
  return { network: Math.floor(address / size) * size, prefix };
}
// #endregion cidr

// #region relations
export const containsAddress = (cidr: Cidr, address: number): boolean =>
  address >= cidr.network && address <= lastAddress(cidr);

export const containsCidr = (outer: Cidr, inner: Cidr): boolean =>
  inner.prefix >= outer.prefix && containsAddress(outer, inner.network);

/** Two aligned blocks overlap exactly when one contains the other. */
export const overlaps = (a: Cidr, b: Cidr): boolean => containsCidr(a, b) || containsCidr(b, a);

/** The `index`-th block of length `prefix` inside `parent`, counted from the lowest address. */
export function subnetAt(parent: Cidr, prefix: number, index: number): Cidr {
  if (prefix < parent.prefix || prefix > 32) {
    throw new Error(`a /${prefix} does not fit inside ${formatCidr(parent)}`);
  }
  const count = 2 ** (prefix - parent.prefix);
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new Error(`${formatCidr(parent)} holds ${count} blocks of /${prefix}; index ${index} is out of range`);
  }
  return { network: parent.network + index * 2 ** (32 - prefix), prefix };
}
// #endregion relations

// #region usable
// A VPC subnet keeps the first four addresses and the last one for itself.
export const AWS_RESERVED_PER_SUBNET = 5;

export const usableAddresses = (cidr: Cidr): number => Math.max(0, sizeOf(cidr) - AWS_RESERVED_PER_SUBNET);
// #endregion usable
