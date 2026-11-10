import { digest } from "#/hash";
import type { Acquisition, Feed, FeedStatus, ProductIndexEntry } from "#/registry/feed-model";

/** A runner's complete current selection and the operational state a fresh Registry mirrors. */
export interface RunnerSnapshot {
  feed: Feed;
  products: ProductIndexEntry[];
  status: FeedStatus;
  recentAcquisitions: Acquisition[];
  /** Content-addressed identity of the complete product selection, plus the acquisition that most recently published it when known. */
  publication: {
    id: string;
    acquisitionId: string | null;
  };
}

/** The same complete selection always has the same publication identity. */
export function runnerPublicationId(feedId: string, products: ProductIndexEntry[]): string {
  const ordered = [...products].sort((left, right) => left.productKey.localeCompare(right.productKey));
  return `snapshot_${digest(JSON.stringify({ feedId, products: ordered }))}`;
}
