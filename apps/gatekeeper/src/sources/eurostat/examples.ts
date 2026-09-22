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
} as const;

export const EUROSTAT_EXAMPLES: ExampleFeed[] = [
  {
    slug: "eurostat-portugal-monthly-unemployment",
    dataset: "eurostat-portugal-monthly-unemployment",
    config: {
      source: "eurostat",
      dataset: "une_rt_m",
      filters: "age=TOTAL&freq=M&geo=PT&s_adj=SA&sex=T&unit=PC_ACT",
      lastTimePeriod: "120",
      lang: "EN",
    },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * DAY,
  },
  {
    slug: "eurostat-portugal-hicp-annual-rate",
    dataset: "eurostat-portugal-hicp-annual-rate",
    config: {
      source: "eurostat",
      dataset: "prc_hicp_manr",
      filters: "coicop=CP00&freq=M&geo=PT",
      lastTimePeriod: "120",
      lang: "EN",
    },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * DAY,
  },
  {
    slug: "eurostat-portugal-tourism-nights",
    dataset: "eurostat-portugal-tourism-nights",
    config: {
      source: "eurostat",
      dataset: "tour_occ_nim",
      filters: "c_resid=TOTAL&freq=M&geo=PT&nace_r2=I551-I553&unit=NR",
      lastTimePeriod: "120",
      lang: "EN",
    },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * DAY,
  },
  {
    slug: "eurostat-portugal-quarterly-gdp",
    dataset: "eurostat-portugal-quarterly-gdp",
    config: {
      source: "eurostat",
      dataset: "namq_10_gdp",
      filters: "freq=Q&geo=PT&na_item=B1GQ&s_adj=SCA&unit=CLV10_MEUR",
      lastTimePeriod: "80",
      lang: "EN",
    },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * DAY,
  },
  {
    slug: "eurostat-portugal-house-price-index",
    dataset: "eurostat-portugal-house-price-index",
    config: {
      source: "eurostat",
      dataset: "prc_hpi_q",
      filters: "freq=Q&geo=PT&purchase=TOTAL&unit=I15_Q",
      lastTimePeriod: "80",
      lang: "EN",
    },
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * DAY,
  },
  portugalMonthly("eurostat-portugal-electricity-generation", "nrg_cb_pem", "freq=M&geo=PT&siec=TOTAL&unit=GWH"),
  portugalMonthly("eurostat-portugal-industrial-production", "sts_inpr_m", "freq=M&geo=PT&indic_bt=PRD&nace_r2=B-D&s_adj=SCA&unit=I21"),
  portugalMonthly("eurostat-portugal-retail-trade-volume", "sts_trtu_m", "freq=M&geo=PT&indic_bt=VOL_SLS&nace_r2=G47&s_adj=SCA&unit=I21"),
  portugalMonthly("eurostat-portugal-economic-sentiment", "ei_bssi_m_r2", "freq=M&geo=PT&indic=BS-ESI-I&s_adj=SA", "Index, long-term average = 100"),
  portugalMonthly("eurostat-portugal-long-term-interest-rate", "irt_lt_mcby_m", "freq=M&geo=PT&int_rt=MCBY", "Percentage per annum"),
];

/**
 * A single monthly Portugal series, keeping the last ten years. Each series is a
 * dataset of its own and this feed is the whole of it, so the two keys are one.
 */
function portugalMonthly(slug: string, portalDataset: string, filters: string, unit?: string): ExampleFeed {
  // Datasets without a unit dimension state their unit here, as documented by Eurostat.
  const config: ExampleFeed["config"] = { source: "eurostat", dataset: portalDataset, filters, lastTimePeriod: "120", lang: "EN" };
  if (unit) config.unit = unit;
  return {
    slug,
    dataset: slug,
    config,
    policy: DAILY_STATISTICS,
    staleAfterSeconds: 7 * DAY,
  };
}
