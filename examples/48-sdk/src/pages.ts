import { type DynamoDBClient, paginateScan, type ScanCommandInput } from "@aws-sdk/client-dynamodb";

// #region pages
export type Scanned = {
  items: Record<string, unknown>[];
  /** False when `maxPages` stopped the loop with more of the table left. */
  complete: boolean;
  pages: number;
};

/**
 * Follows `LastEvaluatedKey` with the SDK's paginator, up to `maxPages` requests. A paginator
 * has no limit of its own: it asks until the service stops handing back a key.
 */
export async function scanPages(
  client: DynamoDBClient,
  input: ScanCommandInput,
  options: { pageSize: number; maxPages: number },
): Promise<Scanned> {
  const items: Record<string, unknown>[] = [];
  let pages = 0;
  for await (const page of paginateScan({ client, pageSize: options.pageSize }, input)) {
    pages += 1;
    items.push(...(page.Items ?? []));
    if (page.LastEvaluatedKey === undefined) {
      return { items, complete: true, pages };
    }
    if (pages >= options.maxPages) {
      // Leaving the loop is all it takes: the paginator sends nothing until asked for a page.
      return { items, complete: false, pages };
    }
  }
  return { items, complete: true, pages };
}
// #endregion pages
