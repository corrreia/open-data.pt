import type { FeedDefinition } from "../../catalog/define";

/** A reference layer read once a day, whole, keeping only what changed. */
export function arcgisReferencePolicy(name: string): FeedDefinition["policy"] {
  return {
    name,
    version: 1,
    collection: {
      cadenceSeconds: 86_400,
      timeoutSeconds: 60,
      maxBytes: 5 * 1024 * 1024,
      historyMode: "changes" as const,
    },
  };
}
