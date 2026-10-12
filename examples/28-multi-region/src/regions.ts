// #region regions
// Tokyo answers; Osaka stands by. Both are in Japan, so the data stays in one country.
export const PRIMARY_REGION = "ap-northeast-1";
export const STANDBY_REGION = "ap-northeast-3";

export const REGIONS = [PRIMARY_REGION, STANDBY_REGION] as const;
export type Region = (typeof REGIONS)[number];

// A stack in one Region cannot read a value from a stack in another, so the two
// stacks agree on these names in advance instead of passing them to each other.
export const TABLE_NAME = "aih-multi-region-notes";
export const uploadsBucketName = (accountId: string, region: Region): string =>
  `aih-multi-region-uploads-${accountId}-${region}`;
// #endregion regions

export const otherRegion = (region: Region): Region =>
  region === PRIMARY_REGION ? STANDBY_REGION : PRIMARY_REGION;

export function isRegion(value: string): value is Region {
  return (REGIONS as readonly string[]).includes(value);
}
