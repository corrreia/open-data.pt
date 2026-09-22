import type { FeedDefinition } from "../../catalog/define";

export const MIB = 1024 * 1024;

export function annualPolicy(name: string, maxBytes: number): FeedDefinition["policy"] {
  return {
    name,
    version: 1,
    collection: {
      cadenceSeconds: 86_400,
      timeoutSeconds: 45,
      maxBytes,
      historyMode: "changes",
    },
  };
}

interface GovernmentDistribution {
  slug: string;
  /** Names the product the source publishes; the dataset carries the prose. */
  title: string;
  /** The dataset id on dados.gov.pt. */
  portalDataset: string;
  /** Omitted for a publisher that uploads each release as a new resource: the newest in `format` is read. */
  distributionId?: string;
  format: "csv" | "json";
  cadenceSeconds: number;
  maxBytes: number;
  maxOutputBytes: number;
  keyField?: string;
  eventTimeField?: string;
}

/** One tabular distribution on dados.gov.pt, read as a product of its own. */
export function governmentFeed(source: GovernmentDistribution): FeedDefinition {
  const config: FeedDefinition["config"] = {
    source: "udata",
    feed: "distribution",
    transformer: "tabular",
    baseUrl: "https://dados.gov.pt",
    dataset: source.portalDataset,
    format: source.format,
    productSlug: source.slug.replace(/-feed$/, ""),
    productTitle: source.title,
  };
  if (source.distributionId) config.distributionId = source.distributionId;
  if (source.keyField) config.keyField = source.keyField;
  if (source.eventTimeField) config.eventTimeField = source.eventTimeField;
  return {
    slug: source.slug,
    config,
    policy: {
      name: source.title,
      version: 1,
      collection: { cadenceSeconds: source.cadenceSeconds, timeoutSeconds: 240, maxBytes: source.maxBytes, maxOutputBytes: source.maxOutputBytes, historyMode: "changes" },
    },
    staleAfterSeconds: source.cadenceSeconds * 3,
  };
}
