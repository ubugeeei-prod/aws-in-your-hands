import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { type Access, checkTarget, type Identity, resolveTarget, type Target } from "./target.ts";

export async function fetchIdentity(region: string): Promise<Identity> {
  const response = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));
  if (response.Account === undefined || response.Arn === undefined) {
    throw new Error("sts:GetCallerIdentity returned no account or ARN");
  }
  return { accountId: response.Account, arn: response.Arn };
}

export type Preflight = { target: Target; identity: Identity };

/** Every task that touches AWS starts here, so the wrong account stops it early. */
export async function preflight(options: {
  access: Access;
  action: string;
  stack?: string;
  env?: Record<string, string | undefined>;
}): Promise<Preflight> {
  const target = resolveTarget(options.env ?? process.env);
  let identity: Identity;
  try {
    identity = await fetchIdentity(target.region);
  } catch (error) {
    throw new Error(
      "Could not identify the AWS credentials in use. Run `aws login` (or `aws sso login`) and select the " +
        "profile with AWS_PROFILE, then retry.",
      { cause: error },
    );
  }

  console.error(
    [
      `action:  ${options.action} (${options.access === "mutate" ? "changes AWS" : "reads AWS"})`,
      `account: ${identity.accountId}`,
      `region:  ${target.region}`,
      `caller:  ${identity.arn}`,
      ...(options.stack === undefined ? [] : [`stack:   ${options.stack}`]),
    ].join("\n"),
  );

  const check = checkTarget(target, identity, options.access);
  if (!check.ok) {
    throw new Error(check.reason);
  }
  return { target, identity };
}
