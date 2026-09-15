import type { ExampleFeed } from "../../index";
import { EUROSTAT_MAX_BYTES } from "./eurostat";

const DAY = 86_400;

const DAILY_STATISTICS = {
  name: "Eurostat daily dataset snapshot",
  version: 1,
  collection: {
    cadenceSeconds: DAY,
    timeoutSeconds: 30,
    maxBytes: EUROSTAT_MAX_BYTES,
    historyMode: "changes",
  },
  serving: {
    licence: "Eurostat copyright and licence policy",
    attribution: "Eurostat",
  },
} as const;

export const EUROSTAT_EXAMPLES: ExampleFeed[] = [
  {
    slug: "eurostat-portugal-monthly-unemployment",
    title: "Portugal monthly unemployment rate",
    description:
      "Seasonally adjusted monthly unemployment rate for Portugal's total labour force.",
    config: {
      source: "eurostat",
      dataset: "une_rt_m",
      filters: "age=TOTAL&freq=M&geo=PT&s_adj=SA&sex=T&unit=PC_ACT",
      lastTimePeriod: "120",
      lang: "EN",
    },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * DAY,
    publisher: "Eurostat",
    topics: ["economy"],
  },
  {
    slug: "eurostat-portugal-hicp-annual-rate",
    title: "Portugal harmonised inflation annual rate",
    description:
      "Monthly all-items Harmonised Index of Consumer Prices annual rate of change for Portugal.",
    config: {
      source: "eurostat",
      dataset: "prc_hicp_manr",
      filters: "coicop=CP00&freq=M&geo=PT",
      lastTimePeriod: "120",
      lang: "EN",
    },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * DAY,
    publisher: "Eurostat",
    topics: ["economy"],
  },
  {
    slug: "eurostat-portugal-tourism-nights",
    title: "Nights in Portugal tourist accommodation",
    description:
      "Monthly nights spent by all residents in Portuguese hotels, short-stay accommodation, and camping sites.",
    config: {
      source: "eurostat",
      dataset: "tour_occ_nim",
      filters: "c_resid=TOTAL&freq=M&geo=PT&nace_r2=I551-I553&unit=NR",
      lastTimePeriod: "120",
      lang: "EN",
    },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * DAY,
    publisher: "Eurostat",
    topics: ["economy"],
  },
  {
    slug: "eurostat-portugal-quarterly-gdp",
    title: "Portugal quarterly gross domestic product",
    description:
      "Seasonally and calendar adjusted quarterly GDP for Portugal in chain-linked 2010 million euros.",
    config: {
      source: "eurostat",
      dataset: "namq_10_gdp",
      filters: "freq=Q&geo=PT&na_item=B1GQ&s_adj=SCA&unit=CLV10_MEUR",
      lastTimePeriod: "80",
      lang: "EN",
    },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * DAY,
    publisher: "Eurostat",
    topics: ["economy"],
  },
  {
    slug: "eurostat-portugal-house-price-index",
    title: "Portugal quarterly house price index",
    description:
      "Quarterly index of all residential property purchases in Portugal, with 2015 equal to 100.",
    config: {
      source: "eurostat",
      dataset: "prc_hpi_q",
      filters: "freq=Q&geo=PT&purchase=TOTAL&unit=I15_Q",
      lastTimePeriod: "80",
      lang: "EN",
    },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * DAY,
    publisher: "Eurostat",
    topics: ["economy"],
  },
  portugalMonthly(
    "eurostat-portugal-electricity-generation",
    "Portugal monthly net electricity generation",
    "Total net electricity generation in Portugal each month, in gigawatt-hours.",
    "nrg_cb_pem",
    "freq=M&geo=PT&siec=TOTAL&unit=GWH",
    ["energy"],
  ),
  portugalMonthly(
    "eurostat-portugal-industrial-production",
    "Portugal monthly industrial production index",
    "Seasonally and calendar adjusted industrial production in Portugal, excluding construction, with 2021 equal to 100.",
    "sts_inpr_m",
    "freq=M&geo=PT&indic_bt=PRD&nace_r2=B-D&s_adj=SCA&unit=I21",
    ["economy"],
  ),
  portugalMonthly(
    "eurostat-portugal-retail-trade-volume",
    "Portugal monthly retail trade volume",
    "Seasonally and calendar adjusted volume of retail sales in Portugal, excluding vehicles, with 2021 equal to 100.",
    "sts_trtu_m",
    "freq=M&geo=PT&indic_bt=VOL_SLS&nace_r2=G47&s_adj=SCA&unit=I21",
    ["economy"],
  ),
  portugalMonthly(
    "eurostat-portugal-economic-sentiment",
    "Portugal economic sentiment indicator",
    "Seasonally adjusted monthly economic sentiment indicator for Portugal.",
    "ei_bssi_m_r2",
    "freq=M&geo=PT&indic=BS-ESI-I&s_adj=SA",
    ["economy"],
    "Index, long-term average = 100",
  ),
  portugalMonthly(
    "eurostat-portugal-long-term-interest-rate",
    "Portugal long-term government bond yield",
    "Monthly 10-year government bond yield for Portugal used for the euro convergence criterion.",
    "irt_lt_mcby_m",
    "freq=M&geo=PT&int_rt=MCBY",
    ["economy"],
    "Percentage per annum",
  ),
];

/** A single monthly Portugal series, keeping the last ten years. */
function portugalMonthly(
  slug: string,
  title: string,
  description: string,
  dataset: string,
  filters: string,
  topics: string[],
  unit?: string,
): ExampleFeed {
  // Datasets without a unit dimension state their unit here, as documented by Eurostat.
  const config: ExampleFeed["config"] = { source: "eurostat", dataset, filters, lastTimePeriod: "120", lang: "EN" };
  if (unit) config.unit = unit;
  return {
    slug,
    title,
    description,
    config,
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * DAY,
    publisher: "Eurostat",
    topics,
  };
}
