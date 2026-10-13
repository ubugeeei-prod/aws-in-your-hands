import * as v from "valibot";

// #region listen
/** Where a server started by hand listens. Lambda never sees this value. */
export const LOCAL_ADDRESS = "127.0.0.1:8787";

const addressSchema = v.pipe(
  v.string(),
  // "host:port". The last colon separates them.
  v.regex(/^[^\s:]+:\d{1,5}$/, 'Must be "host:port".'),
  v.transform((value) => {
    const colon = value.lastIndexOf(":");
    return { host: value.slice(0, colon), port: Number(value.slice(colon + 1)) };
  }),
  v.check(({ port }) => port >= 1 && port <= 65_535, "The port must be between 1 and 65535."),
);

export type ListenAddress = v.InferOutput<typeof addressSchema>;

/**
 * Lambda chooses the address and passes it in AWS_LAMBDA_HTTP_ENDPOINT.
 * A value that is set but unreadable stops the process: listening anywhere else would look
 * like a start, and no request would ever arrive.
 */
export function listenAddress(source: Record<string, string | undefined>): ListenAddress {
  const result = v.safeParse(addressSchema, source["AWS_LAMBDA_HTTP_ENDPOINT"] ?? LOCAL_ADDRESS);
  if (!result.success) {
    throw new Error(
      `AWS_LAMBDA_HTTP_ENDPOINT: ${result.issues.map((issue) => issue.message).join(" ")}`,
    );
  }
  return result.output;
}
// #endregion listen
