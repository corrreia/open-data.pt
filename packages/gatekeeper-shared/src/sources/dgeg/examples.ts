import type { ExampleFeed } from "../../index";
import { FUEL_PRICES_MAX_BYTES, FUEL_TYPES_MAX_BYTES } from "./dgeg";

const SERVING = {
  licence: "Source terms apply",
  attribution: "Direção-Geral de Energia e Geologia",
} as const;

const HOURLY_PRICES = {
  name: "DGEG hourly fuel prices",
  version: 2,
  collection: {
    cadenceSeconds: 3_600,
    timeoutSeconds: 30,
    maxBytes: FUEL_PRICES_MAX_BYTES,
    historyMode: "changes",
  },
  serving: SERVING,
} as const;

export const DGEG_EXAMPLES: ExampleFeed[] = [
  {
    slug: "dgeg-gasolina-simples-95",
    title: "Gasolina simples 95 prices in mainland Portugal",
    description: "Current station prices and hourly municipal medians for gasolina simples 95.",
    config: { source: "dgeg", feed: "fuel-prices", fuelTypeId: "3201" },
    policy: HOURLY_PRICES,
    staleAfterSeconds: 7_200,
    publisher: "DGEG · Direção-Geral de Energia e Geologia",
    topics: ["energy"],
  },
  {
    slug: "dgeg-gasoleo-simples",
    title: "Gasóleo simples prices in mainland Portugal",
    description: "Current station prices and hourly municipal medians for gasóleo simples.",
    config: { source: "dgeg", feed: "fuel-prices", fuelTypeId: "2101" },
    policy: HOURLY_PRICES,
    staleAfterSeconds: 7_200,
    publisher: "DGEG · Direção-Geral de Energia e Geologia",
    topics: ["energy"],
  },
  {
    slug: "dgeg-gasolina-98-lisboa",
    title: "Gasolina 98 prices in Lisbon district",
    description: "Current station prices and hourly municipal medians for gasolina 98 in Lisbon district.",
    config: { source: "dgeg", feed: "fuel-prices", fuelTypeId: "3400", districtId: "11" },
    policy: HOURLY_PRICES,
    staleAfterSeconds: 7_200,
    publisher: "DGEG · Direção-Geral de Energia e Geologia",
    topics: ["energy"],
  },
  {
    slug: "dgeg-gpl-auto",
    title: "GPL Auto prices in mainland Portugal",
    description: "Current station prices and hourly municipal medians for autogas (GPL Auto).",
    config: { source: "dgeg", feed: "fuel-prices", fuelTypeId: "1120" },
    policy: HOURLY_PRICES,
    staleAfterSeconds: 7_200,
    publisher: "DGEG · Direção-Geral de Energia e Geologia",
    topics: ["energy"],
  },
  {
    slug: "dgeg-gasoleo-especial",
    title: "Gasóleo especial prices in mainland Portugal",
    description: "Current station prices and hourly municipal medians for premium diesel (gasóleo especial).",
    config: { source: "dgeg", feed: "fuel-prices", fuelTypeId: "2105" },
    policy: HOURLY_PRICES,
    staleAfterSeconds: 7_200,
    publisher: "DGEG · Direção-Geral de Energia e Geologia",
    topics: ["energy"],
  },
  {
    slug: "dgeg-gasolina-98",
    title: "Gasolina 98 prices in mainland Portugal",
    description: "Current station prices and hourly municipal medians for gasolina 98 across mainland Portugal.",
    config: { source: "dgeg", feed: "fuel-prices", fuelTypeId: "3400" },
    policy: HOURLY_PRICES,
    staleAfterSeconds: 7_200,
    publisher: "DGEG · Direção-Geral de Energia e Geologia",
    topics: ["energy"],
  },
  {
    slug: "dgeg-fuel-types",
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
      serving: SERVING,
    },
    staleAfterSeconds: 172_800,
    publisher: "DGEG · Direção-Geral de Energia e Geologia",
    topics: ["energy"],
  },
];
