import type { FeedDefinition, SourceConfig } from "#/index";
import { MEBIBYTE, WEEK, boundedReportingPeriodFeed } from "#/formats/opendatasoft/feeds";
import { PUBLISHER } from "./index";

const HOST = "e-redes.opendatasoft.com";

export const E_REDES_PERIODIC_SERIES = {
  name: "E-REDES periodic series subset",
  version: 1,
  collection: {
    cadenceSeconds: 604_800,
    timeoutSeconds: 180,
    maxBytes: 8 * MEBIBYTE,
    historyMode: "changes",
  },
} as const;

export const E_REDES_QUARTER_HOUR_SERIES = {
  name: "E-REDES quarter-hour series",
  version: 1,
  collection: {
    cadenceSeconds: 21_600,
    timeoutSeconds: 180,
    maxBytes: 8 * MEBIBYTE,
    historyMode: "changes",
  },
} as const;

/** The part of an E-REDES feed configuration that differs between datasets. */
interface ERedesQuery {
  /** The dataset id on the E-REDES portal. */
  portalDataset: string;
  orderBy: string;
  limit: string;
  where?: string;
  /** Numeric fields to publish as series; the dataset is then not published as a table. */
  series?: string;
}

export function eRedes(slug: string, query: ERedesQuery, policy: FeedDefinition["policy"], staleAfterSeconds: number): FeedDefinition {
  const { portalDataset, ...rest } = query;
  return {
    slug,
    config: { source: "opendatasoft", host: HOST, dataset: portalDataset, ...rest },
    policy,
    staleAfterSeconds,
  };
}

/** An E-REDES dataset read a bounded window of reporting periods at a time. */
export function energy(slug: string, query: SourceConfig, cadenceSeconds = WEEK): FeedDefinition {
  return boundedReportingPeriodFeed(slug, HOST, PUBLISHER.name, query, cadenceSeconds);
}
