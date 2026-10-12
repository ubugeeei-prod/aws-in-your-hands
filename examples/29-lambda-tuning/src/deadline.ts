// A function that Lambda stops at its timeout answers nobody and logs nothing of its own.
// The handler therefore gives itself a deadline a little earlier, and the SDK calls obey it.

import { AsyncLocalStorage } from "node:async_hooks";

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// #region deadline
// Per request, not per process: a local server and Lambda Managed Instances run requests concurrently.
const current = new AsyncLocalStorage<AbortSignal>();

/** Runs `work`. Every SDK call made inside it through `obeyDeadline` stops when `signal` fires. */
export function withDeadline<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  return current.run(signal, work);
}

/** What is left of the function timeout, less the time kept back to answer. */
export function budgetMs(remainingMs: number, answerMarginMs: number): number {
  return Math.max(0, remainingMs - answerMarginMs);
}
// #endregion deadline

// #region client
type Sender = Pick<DynamoDBDocumentClient, "send">;
type Send = Sender["send"];

/** The same client, with the current request's signal passed to every call. */
export function obeyDeadline(client: Sender): Sender {
  const send = (command: Parameters<Send>[0], options?: Parameters<Send>[1]) => {
    const signal = current.getStore();
    return signal === undefined
      ? client.send(command, options)
      : client.send(command, { ...options, abortSignal: signal });
  };
  // `send` is overloaded per command. This wrapper forwards whatever it is given.
  return { send: send as Send };
}
// #endregion client
