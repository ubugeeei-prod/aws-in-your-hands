// Shapes taken from "Using Amazon EventBridge with IVS Low-Latency Streaming".
export const channelArn = "arn:aws:ivs:ap-northeast-1:123456789012:channel/abcdABCDefgh";

let counter = 0;

export function stateChange(eventName: string, streamId: string, time: string, extra: Record<string, string> = {}) {
  counter += 1;
  return {
    version: "0",
    id: `01234567-0123-0123-0123-${String(counter).padStart(12, "0")}`,
    "detail-type": "IVS Stream State Change",
    source: "aws.ivs",
    account: "123456789012",
    time,
    region: "ap-northeast-1",
    resources: [channelArn],
    detail: { event_name: eventName, channel_name: "aih-live", stream_id: streamId, ...extra },
  };
}

export const bitrateBreach = {
  version: "0",
  id: "01234567-0123-0123-0123-999999999999",
  "detail-type": "IVS Limit Breach",
  source: "aws.ivs",
  account: "123456789012",
  time: "2026-10-11T10:05:00Z",
  region: "ap-northeast-1",
  resources: [channelArn],
  detail: {
    limit_name: "Ingest Bitrate",
    limit_value: 3500000,
    exceeded_by: 1200000,
    limit_unit: "bits per second",
    channel_name: "aih-live",
    stream_id: "st-1A2b3c4D5e6F78ghij9Klmn",
  },
};
