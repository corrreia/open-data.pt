import type { FeedPolicy } from "#/catalog/define";

export const MIB = 1024 * 1024;

/** The policy of a uData feed read once a day, recording every change to what it publishes. */
export function annualPolicy(maxBytes: number): FeedPolicy {
  return { cadenceSeconds: 86_400, timeoutSeconds: 45, maxBytes, historyMode: "changes" };
}
