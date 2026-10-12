import * as v from "valibot";

// #region address
/** Where the request came from, as the platform saw it. Never read from a header. */
export type Caller = { sourceAddress: string | undefined };

// On Lambda, API Gateway writes the address it saw into the event. No header can change it.
// On the development server it is the other end of the socket: see dev.ts.
const eventSchema = v.object({
  requestContext: v.object({ http: v.object({ sourceIp: v.string() }) }),
});

/** The address in an API Gateway event, or nothing when the event does not carry one. */
export function sourceAddressOf(event: unknown): string | undefined {
  const parsed = v.safeParse(eventSchema, event);
  return parsed.success ? parsed.output.requestContext.http.sourceIp : undefined;
}
// #endregion address

// #region subject
/** Everyone whose address is missing or unreadable shares this one counter: stricter, never looser. */
export const UNKNOWN_CALLER = "unknown";

const ipv4 = v.pipe(v.string(), v.ipv4());
const ipv6 = v.pipe(v.string(), v.ipv6());
const MAPPED_IPV4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

/** The first 64 bits. One network hands a caller that many addresses, so they count as one. */
function ipv6Network(address: string): string {
  const [head = "", tail] = address.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined || tail === "" ? [] : tail.split(":");
  const groups =
    tail === undefined
      ? left
      : [
          ...left,
          ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"),
          ...right,
        ];
  return groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(":");
}

/** Whom the rate limit counts. */
export function rateSubject(address: string | undefined): string {
  const mapped = address === undefined ? null : MAPPED_IPV4.exec(address);
  const plain = mapped?.[1] ?? address;
  if (v.is(ipv4, plain)) {
    return `ip4-${plain}`;
  }
  if (v.is(ipv6, plain)) {
    return `ip6-${ipv6Network(plain)}`;
  }
  return UNKNOWN_CALLER;
}
// #endregion subject
