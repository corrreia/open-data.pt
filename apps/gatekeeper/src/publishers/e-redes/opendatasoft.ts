import { MEBIBYTE, MONTH, WEEK, boundedReportingPeriodPolicy } from "#/formats/opendatasoft/feeds";
import { PUBLISHER } from "./index";

/** E-REDES's Opendatasoft portal, which every E-REDES feed reads. */
export const E_REDES_HOST = "e-redes.opendatasoft.com";

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

/** A bounded window of reporting periods, read once a week. */
export const E_REDES_WEEKLY_PERIODS = boundedReportingPeriodPolicy(PUBLISHER.name, WEEK);

/** A bounded window of reporting periods, read once a month. */
export const E_REDES_MONTHLY_PERIODS = boundedReportingPeriodPolicy(PUBLISHER.name, MONTH);
