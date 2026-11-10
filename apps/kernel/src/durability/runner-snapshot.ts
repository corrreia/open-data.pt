import { digest } from "#/hash";
import type { Acquisition, Feed, FeedStatus, ProductIndexEntry } from "#/registry/feed-model";

/** One complete runner selection. Its number orders retries; its id is stable across them. */
export interface RunnerPublication {
  id: string;
  number: number;
  feedId: string;
  acquisitionId: string | null;
  entries: ProductIndexEntry[];
  supersededObjectKeys: string[];
}

/** A durable Registry answer covering every publication through the named number. */
export type RunnerPublicationReceipt =
  | { known: false; backfillPeers: 0 }
  | {
      known: true;
      backfillPeers: number;
      acceptedPublicationId: string;
      acceptedThrough: number;
      selectedAt: string;
    };

/** A runner's complete current selection and the operational state a fresh Registry mirrors. */
export interface RunnerSnapshot {
  feed: Feed;
  products: ProductIndexEntry[];
  status: FeedStatus;
  recentAcquisitions: Acquisition[];
  publication: RunnerPublication;
}

/** A publication keeps the same identity through every Registry retry. */
export function runnerPublicationId(feedId: string, number: number, acquisitionId: string | null): string {
  return `publication_${digest(JSON.stringify({ feedId, number, acquisitionId }))}`;
}
