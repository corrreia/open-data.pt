import { EUROSTAT_MAX_BYTES } from "./eurostat";

export const DAY = 86_400;

export const DAILY_STATISTICS = {
  name: "Eurostat daily dataset snapshot",
  version: 1,
  collection: {
    cadenceSeconds: DAY,
    timeoutSeconds: 30,
    maxBytes: EUROSTAT_MAX_BYTES,
    historyMode: "changes",
  },
} as const;
