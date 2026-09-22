import type { ExampleFeed } from "../../index";

const MEBIBYTE = 1024 * 1024;

const DAILY_STATISTICS = {
  name: "INE daily indicator snapshot",
  version: 1,
  collection: {
    cadenceSeconds: 86_400,
    timeoutSeconds: 120,
    maxBytes: 8 * MEBIBYTE,
    historyMode: "changes",
  },
} as const;

const MONTHLY_SERIES = {
  ...DAILY_STATISTICS,
  name: "INE monthly indicator series",
  collection: {
    ...DAILY_STATISTICS.collection,
    cadenceSeconds: 604_800,
  },
} as const;

const ANNUAL_SERIES = {
  ...DAILY_STATISTICS,
  name: "INE annual indicator series",
  collection: {
    ...DAILY_STATISTICS.collection,
    cadenceSeconds: 2_592_000,
  },
} as const;

export const INE_EXAMPLES: ExampleFeed[] = [
  {
    slug: "ine-resident-population",
    dataset: "ine-resident-population",
    config: { source: "ine", indicator: "0004167", lang: "PT" },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * 86_400,
  },
  {
    slug: "ine-unemployment-rate",
    dataset: "ine-unemployment-rate",
    config: { source: "ine", indicator: "0007976", lang: "PT" },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * 86_400,
  },
  {
    slug: "ine-tourism-overnight-stays",
    dataset: "ine-tourism-overnight-stays",
    config: { source: "ine", indicator: "0012092", lang: "PT" },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * 86_400,
  },
  {
    slug: "ine-consumer-price-index",
    dataset: "ine-consumer-price-index",
    config: { source: "ine", indicator: "0014640", lang: "PT" },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * 86_400,
  },
  {
    slug: "ine-crime-rate",
    dataset: "ine-crime-rate",
    config: {
      source: "ine",
      indicator: "0008074",
      lang: "PT",
      dims: "Dim1=S7A2020,S7A2021,S7A2022",
    },
    policy: ANNUAL_SERIES,
    staleAfterSeconds: 5_184_000,
  },
  {
    slug: "ine-median-home-sale-price",
    dataset: "ine-median-home-sale-price",
    config: {
      source: "ine",
      indicator: "0012255",
      lang: "PT",
      dims: "Dim1=S7A2023,S7A2024,S7A2025",
    },
    policy: ANNUAL_SERIES,
    staleAfterSeconds: 5_184_000,
  },
  {
    slug: "ine-live-births",
    dataset: "ine-live-births",
    config: {
      source: "ine",
      indicator: "0012094",
      lang: "PT",
      dims: "Dim1=S3A202601,S3A202602,S3A202603,S3A202604,S3A202605,S3A202606",
    },
    policy: MONTHLY_SERIES,
    staleAfterSeconds: 1_209_600,
  },
  {
    slug: "ine-employment-rate",
    dataset: "ine-employment-rate",
    config: {
      source: "ine",
      indicator: "0007971",
      lang: "PT",
      dims: "Dim1=S3A202602,S3A202603,S3A202604,S3A202605,S3A202606,S3A202607",
    },
    policy: MONTHLY_SERIES,
    staleAfterSeconds: 1_209_600,
  },
  {
    slug: "ine-average-monthly-earnings",
    dataset: "ine-average-monthly-earnings",
    config: {
      source: "ine",
      indicator: "0012656",
      lang: "PT",
      dims: "Dim1=S7A2022,S7A2023,S7A2024",
    },
    policy: ANNUAL_SERIES,
    staleAfterSeconds: 5_184_000,
  },
  latestPeriod("ine-airport-passengers-embarked", "0000861"),
  latestPeriod("ine-heavy-rail-passengers", "0000901"),
  latestPeriod("ine-industrial-production-index", "0011889"),
  latestPeriod("ine-house-price-index", "0009201"),
  latestPeriod("ine-housing-transactions-value", "0012786"),
  latestPeriod("ine-median-bank-valuation", "0012248"),
  annualLatest("ine-taxpayer-income-distribution", "0012759"),
  annualLatest("ine-median-household-income-after-tax", "0012741"),
  annualLatest("ine-household-income-gini", "0012744"),
  annualLatest("ine-declared-income-per-inhabitant", "0012672"),
  annualLatest("ine-household-income-p90-p10", "0012746"),
  annualLatest("ine-fixed-broadband-accesses", "0013140"),
  annualLatest("ine-fixed-broadband-accesses-per-100", "0013424"),
  annualLatest("ine-broadband-accesses-per-100", "0013135"),
  annualLatest("ine-household-broadband-access", "0013826"),
  annualLatest("ine-fixed-telephone-clients", "0006851"),
  annualLatest("ine-broadband-data-traffic", "0006868"),
];

/** One indicator is one dataset and this feed is the whole of it, so the two keys are one. */
function annualLatest(slug: string, indicator: string): ExampleFeed {
  const policy = indicator === "0012759" ? { ...ANNUAL_SERIES, version: 2 } : ANNUAL_SERIES;
  return {
    slug,
    dataset: slug,
    config: { source: "ine", indicator, lang: "PT" },
    policy,
    staleAfterSeconds: 5_184_000,
  };
}

/**
 * An indicator read without a period filter, so INE returns only its latest
 * period. Collecting it daily keeps every published period in our history,
 * which INE's own endpoint does not return in one call.
 */
function latestPeriod(slug: string, indicator: string): ExampleFeed {
  return {
    slug,
    dataset: slug,
    config: { source: "ine", indicator, lang: "PT" },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * 86_400,
  };
}
