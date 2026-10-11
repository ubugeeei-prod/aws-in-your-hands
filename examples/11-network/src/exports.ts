// Names shared by the stack that exports and the helper that imports.

export const NETWORK_STACK = "AihNetwork";

// #region names
/** Export names are unique per account and region, hence the stack prefix. */
export const exportName = (output: string): string => `${NETWORK_STACK}-${output}`;

export const outputNames = {
  vpcId: "VpcId",
  vpcCidr: "VpcCidr",
  /** 1-based, in the order of the plan. */
  zone: (index: number): string => `Az${index}`,
  subnetId: (subnetId: string): string => `${subnetId}SubnetId`,
  routeTableId: (subnetId: string): string => `${subnetId}RouteTableId`,
};
// #endregion names
