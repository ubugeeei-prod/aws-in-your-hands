import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// #region translate
/**
 * The document client with its translation written out. These are the defaults of
 * @aws-sdk/lib-dynamodb 3.1149.0, and a test pins what each one does.
 */
export function documentClient(client: DynamoDBClient): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      // An empty string is stored as an empty string, not as NULL.
      convertEmptyValues: false,
      // `undefined` inside a map or a list throws before anything is sent.
      removeUndefinedValues: false,
      // A Date or a class instance throws. Turning this on would store a Date as an empty map.
      convertClassInstanceToMap: false,
    },
    unmarshallOptions: {
      // Numbers come back as `number`. An integer too large for one comes back as a `bigint`,
      // and a decimal with more digits than a double holds is rounded without a word.
      wrapNumbers: false,
    },
  });
}
// #endregion translate
