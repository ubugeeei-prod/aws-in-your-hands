// What CloudFormation drift detection covers for the resource types of ShipApiStack,
// from the "Drift detection" column of "Resource type support" in the CloudFormation
// User Guide, read on 2026-10-12. Not confirmed against a deployed stack.

// #region coverage
export const DRIFT_CHECKED_TYPES = [
  "AWS::ApiGatewayV2::Api",
  "AWS::ApiGatewayV2::Route",
  "AWS::ApiGatewayV2::Stage",
  "AWS::IAM::Role",
  "AWS::Lambda::Alias",
  "AWS::Lambda::Function",
  "AWS::Lambda::Permission",
  "AWS::Lambda::Version",
  "AWS::Logs::LogGroup",
] as const;

/**
 * Types in the stack that drift detection does not check. Listing one here lets the
 * drift task exit 0 without it. The report still says "unsupported", and something
 * else has to watch these resources: here, the smoke test after each deploy.
 */
export const ACKNOWLEDGED_UNCHECKED_TYPES = ["AWS::ApiGatewayV2::Integration"] as const;
// #endregion coverage
