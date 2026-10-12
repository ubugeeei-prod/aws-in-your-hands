// Hand-written answers in the shape the AWS CLI prints. None of them was recorded from an
// account: the field names come from the API references below, the values are made up.
//
//   sts get-caller-identity      `aws sts get-caller-identity help`, AWS CLI 2.35.11
//   budgets describe-budget      docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_DescribeBudget.html
//   s3api list-object-versions   docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html
//   s3api delete-objects         docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html
//   state.json                   StackState in @go-to-k/cdkd 0.296.28 (dist/index.d.ts)

export const ACCOUNT = "111111111111";
export const REGION = "ap-northeast-1";

export const caller = {
  UserId: "AIDAEXAMPLEEXAMPLEEXA",
  Account: ACCOUNT,
  Arn: `arn:aws:iam::${ACCOUNT}:user/aih-dev`,
};

export const budget = {
  Budget: {
    BudgetName: "aih-monthly",
    BudgetLimit: { Amount: "10", Unit: "USD" },
    BudgetType: "COST",
    TimeUnit: "MONTHLY",
    CalculatedSpend: {
      ActualSpend: { Amount: "3.412", Unit: "USD" },
      ForecastedSpend: { Amount: "12.8", Unit: "USD" },
    },
  },
};

/** What `--query 'Contents[].Key'` leaves of a ListObjectsV2 answer. */
export const stateKeys = [
  "cdkd/AihHello/ap-northeast-1/state.json",
  "cdkd/AihNetwork/ap-northeast-1/state.json",
  "cdkd/AihNetwork/ap-northeast-1/lock.json",
  "cdkd/AihEc2/state.json",
];

export const states: Record<string, unknown> = {
  "cdkd/AihHello/ap-northeast-1/state.json": {
    version: 1,
    stackName: "AihHello",
    region: REGION,
    resources: {
      PracticeBucket: {
        physicalId: "aihhello-practicebucket-example",
        resourceType: "AWS::S3::Bucket",
        properties: {},
      },
    },
    outputs: {},
    lastModified: 1791849600000,
  },
  "cdkd/AihNetwork/ap-northeast-1/state.json": {
    version: 1,
    stackName: "AihNetwork",
    region: REGION,
    resources: {
      Vpc: { physicalId: "vpc-0example", resourceType: "AWS::EC2::VPC", properties: {} },
      S3Endpoint: {
        physicalId: "vpce-0gateway",
        resourceType: "AWS::EC2::VPCEndpoint",
        properties: { VpcEndpointType: "Gateway" },
      },
      SqsEndpoint: {
        physicalId: "vpce-0interface",
        resourceType: "AWS::EC2::VPCEndpoint",
        properties: { VpcEndpointType: "Interface" },
      },
      Nat: { physicalId: "nat-0example", resourceType: "AWS::EC2::NatGateway", properties: {} },
      NatAddress: { physicalId: "eipalloc-0example", resourceType: "AWS::EC2::EIP" },
    },
    outputs: {},
    lastModified: 1791849600000,
  },
  // The layout before cdkd keyed state by Region: no Region in the key or the body.
  "cdkd/AihEc2/state.json": {
    version: 1,
    stackName: "AihEc2",
    resources: {
      Instance: { physicalId: "i-0123456789abcdef0", resourceType: "AWS::EC2::Instance" },
      DataVolume: { physicalId: "vol-0example", resourceType: "AWS::EC2::Volume" },
    },
    outputs: {},
    lastModified: 1791849600000,
  },
};

export type FakeVersion = { Key: string; VersionId: string; Size?: number; marker?: boolean };

/** A versioned bucket after one overwrite and one delete. */
export const uploads: FakeVersion[] = [
  { Key: "notes/a.png", VersionId: "v2", Size: 2048 },
  { Key: "notes/a.png", VersionId: "v1", Size: 1024 },
  { Key: "notes/b.png", VersionId: "m1", marker: true },
  { Key: "notes/b.png", VersionId: "v1", Size: 512 },
];
