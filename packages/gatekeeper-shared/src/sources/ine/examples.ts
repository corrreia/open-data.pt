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
  serving: {
    licence: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    attribution: "Instituto Nacional de Estatística (INE)",
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
    title: "Resident population by sex and age group",
    description: "Annual resident population by place of residence, sex, and life-cycle age group.",
    config: { source: "ine", indicator: "0004167", lang: "PT" },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * 86_400,
    publisher: "INE · Instituto Nacional de Estatística",
    topics: ["society"],
  },
  {
    slug: "ine-unemployment-rate",
    title: "Monthly unemployment rate by age group",
    description: "Monthly unemployment rate for people aged 16 to 74, split by age group.",
    config: { source: "ine", indicator: "0007976", lang: "PT" },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * 86_400,
    publisher: "INE · Instituto Nacional de Estatística",
    topics: ["economy"],
  },
  {
    slug: "ine-tourism-overnight-stays",
    title: "Monthly overnight stays in tourist accommodation",
    description: "Monthly overnight stays by NUTS 2024 geography and accommodation type.",
    config: { source: "ine", indicator: "0012092", lang: "PT" },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * 86_400,
    publisher: "INE · Instituto Nacional de Estatística",
    topics: ["economy"],
  },
  {
    slug: "ine-consumer-price-index",
    title: "Monthly consumer price index",
    description: "Monthly consumer price index, 2025 base, by geography and special aggregate.",
    config: { source: "ine", indicator: "0014640", lang: "PT" },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * 86_400,
    publisher: "INE · Instituto Nacional de Estatística",
    topics: ["economy"],
  },
  {
    slug: "ine-crime-rate",
    title: "Crime rate by area and category",
    description: "Annual recorded crime rate by NUTS 2013 geography and crime category for 2020 to 2022.",
    config: {
      source: "ine",
      indicator: "0008074",
      lang: "PT",
      dims: "Dim1=S7A2020,S7A2021,S7A2022",
    },
    policy: ANNUAL_SERIES,
    staleAfterSeconds: 5_184_000,
    publisher: "INE · Instituto Nacional de Estatística",
    topics: ["society"],
  },
  {
    slug: "ine-median-home-sale-price",
    title: "Median home sale price per square metre",
    description: "Annual median sale price of family homes by NUTS 2024 geography and home category for 2023 to 2025.",
    config: {
      source: "ine",
      indicator: "0012255",
      lang: "PT",
      dims: "Dim1=S7A2023,S7A2024,S7A2025",
    },
    policy: ANNUAL_SERIES,
    staleAfterSeconds: 5_184_000,
    publisher: "INE · Instituto Nacional de Estatística",
    topics: ["economy"],
  },
  {
    slug: "ine-live-births",
    title: "Monthly live births by area and sex",
    description: "Live births by the mother's NUTS 2024 area of residence and sex for January to June 2026.",
    config: {
      source: "ine",
      indicator: "0012094",
      lang: "PT",
      dims: "Dim1=S3A202601,S3A202602,S3A202603,S3A202604,S3A202605,S3A202606",
    },
    policy: MONTHLY_SERIES,
    staleAfterSeconds: 1_209_600,
    publisher: "INE · Instituto Nacional de Estatística",
    topics: ["society"],
  },
  {
    slug: "ine-employment-rate",
    title: "Monthly employment rate by sex",
    description: "Employment rate among residents aged 16 to 74 by sex for February to July 2026.",
    config: {
      source: "ine",
      indicator: "0007971",
      lang: "PT",
      dims: "Dim1=S3A202602,S3A202603,S3A202604,S3A202605,S3A202606,S3A202607",
    },
    policy: MONTHLY_SERIES,
    staleAfterSeconds: 1_209_600,
    publisher: "INE · Instituto Nacional de Estatística",
    topics: ["economy"],
  },
  {
    slug: "ine-average-monthly-earnings",
    title: "Average monthly earnings by area",
    description: "Annual average monthly earnings by NUTS 2024 geography for 2022 to 2024.",
    config: {
      source: "ine",
      indicator: "0012656",
      lang: "PT",
      dims: "Dim1=S7A2022,S7A2023,S7A2024",
    },
    policy: ANNUAL_SERIES,
    staleAfterSeconds: 5_184_000,
    publisher: "INE · Instituto Nacional de Estatística",
    topics: ["economy"],
  },
  latestPeriod(
    "ine-airport-passengers-embarked",
    "Passengers boarding at Portuguese airports",
    "Passengers embarked at each Portuguese airport in the latest month, by type of traffic.",
    "0000861",
    ["mobility"],
  ),
  latestPeriod("ine-heavy-rail-passengers", "Heavy rail passengers", "Passengers carried by heavy rail operators in the latest month, by type of service.", "0000901", [
    "mobility",
  ]),
  latestPeriod(
    "ine-industrial-production-index",
    "Industrial production index",
    "Calendar and seasonally adjusted industrial production index for the latest month, with 2021 equal to 100.",
    "0011889",
    ["economy"],
  ),
  latestPeriod("ine-house-price-index", "House price index", "Quarterly house price index by dwelling category, with 2015 equal to 100.", "0009201", ["economy"]),
  latestPeriod("ine-housing-transactions-value", "Value of housing transactions", "Quarterly value of family dwelling sales by NUTS 2024 area and dwelling category.", "0012786", [
    "economy",
  ]),
  latestPeriod(
    "ine-median-bank-valuation",
    "Median bank valuation of housing",
    "Median bank valuation of housing per square metre by municipality and dwelling type, for the latest month.",
    "0012248",
    ["economy"],
  ),
  annualLatest(
    "ine-taxpayer-income-distribution",
    "Declared income after assessed tax by income quintile",
    "Annual distribution of taxpayers' gross declared income less assessed income tax, by NUTS 2024 geography and income quintile. Uses the current indicator, not the discontinued NUTS 2013 series.",
    "0012759",
  ),
  annualLatest(
    "ine-median-household-income-after-tax",
    "Median declared household income after assessed tax",
    "Latest annual median gross declared income less assessed income tax per tax household, by NUTS 2024 geography.",
    "0012741",
  ),
  annualLatest(
    "ine-household-income-gini",
    "Household income inequality: Gini coefficient",
    "Latest annual Gini coefficient of declared household income less assessed income tax, by NUTS 2024 geography.",
    "0012744",
  ),
  annualLatest(
    "ine-declared-income-per-inhabitant",
    "Declared income after assessed tax per inhabitant",
    "Latest annual gross declared income less assessed income tax per inhabitant, by NUTS 2024 geography.",
    "0012672",
  ),
  annualLatest(
    "ine-household-income-p90-p10",
    "Household income inequality: P90/P10 ratio",
    "Latest annual ratio between the 90th and 10th percentiles of declared household income less assessed income tax, by NUTS 2024 geography.",
    "0012746",
  ),
  annualLatest(
    "ine-fixed-broadband-accesses",
    "Fixed-location broadband accesses",
    "Latest annual number of fixed-location broadband accesses by NUTS 2024 geography, published through INE's telecommunications survey. These are accesses, not individual users or real-time availability.",
    "0013140",
    ["telecom", "society"],
  ),
  annualLatest(
    "ine-fixed-broadband-accesses-per-100",
    "Fixed broadband accesses per 100 inhabitants by technology",
    "Latest annual fixed-location broadband access rate by NUTS 2024 geography and access technology. This measures subscription penetration, not network coverage or customer outages.",
    "0013424",
    ["telecom", "society"],
  ),
  annualLatest(
    "ine-broadband-accesses-per-100",
    "Broadband accesses per 100 inhabitants by segment",
    "Latest annual broadband accesses per 100 inhabitants by NUTS 2024 geography and access segment. The subscription rate is not a count of unique people connected.",
    "0013135",
    ["telecom", "society"],
  ),
  annualLatest(
    "ine-household-broadband-access",
    "Households with broadband internet access",
    "Latest annual proportion of private households with at least one resident aged 16 to 74 and a home broadband connection, by NUTS 2024 area. These are aggregate survey statistics, not household-level records.",
    "0013826",
    ["telecom", "society"],
  ),
  annualLatest(
    "ine-fixed-telephone-clients",
    "Fixed-telephone service clients",
    "Latest annual number of direct-access fixed-telephone service clients by access segment, from INE's telecommunications survey.",
    "0006851",
    ["telecom", "society"],
  ),
  annualLatest(
    "ine-broadband-data-traffic",
    "Broadband internet data traffic by network type",
    "Latest annual broadband internet traffic in gigabytes by network type, from INE's telecommunications survey. Traffic volume is not connection speed or outage information.",
    "0006868",
    ["telecom", "society"],
  ),
];

function annualLatest(slug: string, title: string, description: string, indicator: string, topics: string[] = ["economy", "society"]): ExampleFeed {
  const policy = indicator === "0012759" ? { ...ANNUAL_SERIES, version: 2 } : ANNUAL_SERIES;
  return {
    slug,
    title,
    description,
    config: { source: "ine", indicator, lang: "PT" },
    policy,
    staleAfterSeconds: 5_184_000,
    publisher: "INE · Instituto Nacional de Estatística",
    topics,
  };
}

/**
 * An indicator read without a period filter, so INE returns only its latest
 * period. Collecting it daily keeps every published period in our history,
 * which INE's own endpoint does not return in one call.
 */
function latestPeriod(slug: string, title: string, description: string, indicator: string, topics: string[]): ExampleFeed {
  return {
    slug,
    title,
    description,
    config: { source: "ine", indicator, lang: "PT" },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * 86_400,
    publisher: "INE · Instituto Nacional de Estatística",
    topics,
  };
}
