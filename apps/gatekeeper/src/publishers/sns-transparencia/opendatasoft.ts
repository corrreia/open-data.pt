import { MEBIBYTE, MONTH, WEEK, boundedReportingPeriodPolicy } from "#/formats/opendatasoft/feeds";
import { PUBLISHER } from "./index";

/** SNS Transparência's Opendatasoft portal, which every SNS feed reads. */
export const SNS_HOST = "transparencia.sns.gov.pt";

/** A dataset with one row per hospital and month. */
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

/** A dataset published day by day, collected twice a day. */
export const SNS_DAILY_SERIES = {
  name: "SNS daily series snapshot",
  version: 1,
  collection: {
    cadenceSeconds: 43_200,
    timeoutSeconds: 60,
    maxBytes: 8 * MEBIBYTE,
    historyMode: "changes",
  },
} as const;

/** A bounded window of reporting periods, read once a day. */
export const SNS_DAILY_PERIODS = boundedReportingPeriodPolicy(PUBLISHER.name, 86_400);

/** A bounded window of reporting periods, read once a week. */
export const SNS_WEEKLY_PERIODS = boundedReportingPeriodPolicy(PUBLISHER.name, WEEK);

/** A bounded window of reporting periods, read once a month. */
export const SNS_MONTHLY_PERIODS = boundedReportingPeriodPolicy(PUBLISHER.name, MONTH);
