import type { FeedPolicy } from "#/catalog/define";
import { parliamentDocument, type ParliamentFeed } from "./parliament";
import { PARLIAMENT_MAX_RECORDS } from "./transform";

/** How long one collection may run and how much it may write. */
export interface CollectionLimits {
  timeoutSeconds: number;
  maxOutputBytes: number;
}

/** What most of the XVII legislature's documents need. */
const DEFAULT_LIMITS: CollectionLimits = { timeoutSeconds: 180, maxOutputBytes: 8 * 1024 * 1024 };

/** The collection policy of one XVII legislature document: its cadence, its limits, and its document's own source ceiling. */
export function parliamentPolicy(feed: ParliamentFeed, cadenceSeconds: number, limits: CollectionLimits = DEFAULT_LIMITS): FeedPolicy {
  const document = parliamentDocument({ feed, legislature: "XVII" });
  return {
    name: `Parliament ${feed}: ${cadenceSeconds === 604_800 ? "weekly professional reference" : "daily public record updates"}`,
    version: 1,
    collection: { cadenceSeconds, ...limits, maxBytes: document.sourceBytes, maxRecords: PARLIAMENT_MAX_RECORDS, historyMode: "changes" },
  };
}
