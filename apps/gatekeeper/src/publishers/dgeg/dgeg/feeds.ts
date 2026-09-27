import { FUEL_PRICES_MAX_BYTES } from "./dgeg";

/** The hourly policy every fuel-price feed shares. */
export const HOURLY_PRICES = {
  cadenceSeconds: 3_600,
  timeoutSeconds: 30,
  maxBytes: FUEL_PRICES_MAX_BYTES,
  historyMode: "changes",
} as const;
