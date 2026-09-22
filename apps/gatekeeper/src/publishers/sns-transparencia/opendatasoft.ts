import type { FeedDefinition, SourceConfig } from "../../index";
import { MEBIBYTE, WEEK, boundedReportingPeriodFeed } from "../../formats/opendatasoft/feeds";
import { PUBLISHER } from "./index";

const HOST = "transparencia.sns.gov.pt";

export const SNS_MONTHLY_SERIES = {
  name: "SNS monthly series snapshot",
  version: 1,
  collection: {
    cadenceSeconds: 604_800,
    timeoutSeconds: 180,
    maxBytes: 8 * MEBIBYTE,
    historyMode: "changes",
  },
} as const;

const SNS_DAILY_SERIES = {
  name: "SNS daily series snapshot",
  version: 1,
  collection: {
    cadenceSeconds: 43_200,
    timeoutSeconds: 60,
    maxBytes: 8 * MEBIBYTE,
    historyMode: "changes",
  },
} as const;

/** An SNS dataset published day by day, collected twice a day. */
export function snsDaily(slug: string, portalDataset: string, orderBy: string, limit: string, series?: string): FeedDefinition {
  // Named numeric fields make the dataset a time series; without them it is a table.
  const config: FeedDefinition["config"] = { source: "opendatasoft", host: HOST, dataset: portalDataset, orderBy, limit };
  if (series) config.series = series;
  return {
    slug,
    config,
    policy: SNS_DAILY_SERIES,
    staleAfterSeconds: 172_800,
  };
}

/** An SNS dataset with one row per hospital and month. */
export function snsMonthly(slug: string, portalDataset: string, limit: string): FeedDefinition {
  return {
    slug,
    config: { source: "opendatasoft", host: HOST, dataset: portalDataset, orderBy: "tempo DESC,instituicao", limit },
    policy: SNS_MONTHLY_SERIES,
    staleAfterSeconds: 1_209_600,
  };
}

/** An SNS dataset read a bounded window of reporting periods at a time. */
export function health(slug: string, query: SourceConfig, cadenceSeconds = WEEK): FeedDefinition {
  return boundedReportingPeriodFeed(slug, HOST, PUBLISHER.name, query, cadenceSeconds);
}
