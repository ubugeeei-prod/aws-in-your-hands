import { z } from "zod";

// #region address
// On Lambda, API Gateway writes the address it saw into the event. No header can change it.
const lambdaEnvSchema = z.object({
  requestContext: z.object({ http: z.object({ sourceIp: z.string() }) }),
});
// On the development server, the other end of the socket.
const nodeEnvSchema = z.object({
  incoming: z.object({ socket: z.object({ remoteAddress: z.string() }) }),
});

/** Where the request came from, as the platform saw it. Never read from a header. */
export function sourceAddressOf(env: unknown): string | undefined {
  const onLambda = lambdaEnvSchema.safeParse(env);
  if (onLambda.success) {
    return onLambda.data.requestContext.http.sourceIp;
  }
  const onNode = nodeEnvSchema.safeParse(env);
  return onNode.success ? onNode.data.incoming.socket.remoteAddress : undefined;
}
// #endregion address

// #region subject
/** Everyone whose address is missing or unreadable shares this one counter: stricter, never looser. */
export const UNKNOWN_CALLER = "unknown";

const ipv4 = z.ipv4();
const ipv6 = z.ipv6();
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
  if (ipv4.safeParse(plain).success) {
    return `ip4-${plain}`;
  }
  if (ipv6.safeParse(plain).success && plain !== undefined) {
    return `ip6-${ipv6Network(plain)}`;
  }
  return UNKNOWN_CALLER;
}
// #endregion subject
