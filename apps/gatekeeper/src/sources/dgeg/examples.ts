import type { ExampleFeed } from "../../index";
import { FUEL_PRICES_MAX_BYTES, FUEL_TYPES_MAX_BYTES } from "./dgeg";

const HOURLY_PRICES = {
  name: "DGEG hourly fuel prices",
  version: 2,
  collection: {
    cadenceSeconds: 3_600,
    timeoutSeconds: 30,
    maxBytes: FUEL_PRICES_MAX_BYTES,
    historyMode: "changes",
  },
} as const;

export const DGEG_EXAMPLES: ExampleFeed[] = [
  {
    slug: "dgeg-gasolina-simples-95",
    dataset: "dgeg-fuel-prices",
    title: "Gasolina simples 95 prices in mainland Portugal",
    description: "Current station prices and hourly municipal medians for gasolina simples 95.",
    config: { source: "dgeg", feed: "fuel-prices", fuelTypeId: "3201" },
    policy: HOURLY_PRICES,
    staleAfterSeconds: 7_200,
  },
  {
    slug: "dgeg-gasoleo-simples",
    dataset: "dgeg-fuel-prices",
    title: "Gasóleo simples prices in mainland Portugal",
    description: "Current station prices and hourly municipal medians for gasóleo simples.",
    config: { source: "dgeg", feed: "fuel-prices", fuelTypeId: "2101" },
    policy: HOURLY_PRICES,
    staleAfterSeconds: 7_200,
  },
  // No Lisbon-district feed: its 37 stations are already in dgeg-gasolina-98, which covers the whole mainland.
  {
    slug: "dgeg-gpl-auto",
    dataset: "dgeg-fuel-prices",
    title: "GPL Auto prices in mainland Portugal",
    description: "Current station prices and hourly municipal medians for autogas (GPL Auto).",
    config: { source: "dgeg", feed: "fuel-prices", fuelTypeId: "1120" },
    policy: HOURLY_PRICES,
    staleAfterSeconds: 7_200,
  },
  {
    slug: "dgeg-gasoleo-especial",
    dataset: "dgeg-fuel-prices",
    title: "Gasóleo especial prices in mainland Portugal",
    description: "Current station prices and hourly municipal medians for premium diesel (gasóleo especial).",
    config: { source: "dgeg", feed: "fuel-prices", fuelTypeId: "2105" },
    policy: HOURLY_PRICES,
    staleAfterSeconds: 7_200,
  },
  {
    slug: "dgeg-gasolina-98",
    dataset: "dgeg-fuel-prices",
    title: "Gasolina 98 prices in mainland Portugal",
    description: "Current station prices and hourly municipal medians for gasolina 98 across mainland Portugal.",
    config: { source: "dgeg", feed: "fuel-prices", fuelTypeId: "3400" },
    policy: HOURLY_PRICES,
    staleAfterSeconds: 7_200,
  },
  {
    slug: "dgeg-fuel-types",
    dataset: "dgeg-fuel-prices",
    title: "DGEG fuel types",
    description: "Daily reference list of fuel types and source units used by the price service.",
    config: { source: "dgeg", feed: "fuel-types" },
    policy: {
      name: "DGEG fuel reference data",
      version: 1,
      collection: {
        cadenceSeconds: 86_400,
        timeoutSeconds: 20,
        maxBytes: FUEL_TYPES_MAX_BYTES,
        historyMode: "changes",
      },
    },
    staleAfterSeconds: 172_800,
  },
];
