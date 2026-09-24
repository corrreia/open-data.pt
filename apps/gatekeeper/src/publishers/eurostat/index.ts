import type { PublisherDefinition } from "#/catalog/define";
import { FEED as portugalEconomicSentiment } from "./feeds/portugal-economic-sentiment";
import { FEED as portugalElectricityGeneration } from "./feeds/portugal-electricity-generation";
import { FEED as portugalHicpAnnualRate } from "./feeds/portugal-hicp-annual-rate";
import { FEED as portugalHousePriceIndex } from "./feeds/portugal-house-price-index";
import { FEED as portugalIndustrialProduction } from "./feeds/portugal-industrial-production";
import { FEED as portugalLongTermInterestRate } from "./feeds/portugal-long-term-interest-rate";
import { FEED as portugalMonthlyUnemployment } from "./feeds/portugal-monthly-unemployment";
import { FEED as portugalQuarterlyGdp } from "./feeds/portugal-quarterly-gdp";
import { FEED as portugalRetailTradeVolume } from "./feeds/portugal-retail-trade-volume";
import { FEED as portugalTourismNights } from "./feeds/portugal-tourism-nights";

export const PUBLISHER: PublisherDefinition = {
  name: "Eurostat",
  url: "https://ec.europa.eu/eurostat",
  sources: ["ec.europa.eu"],
  logo: "svg",
  feeds: [
    portugalEconomicSentiment,
    portugalElectricityGeneration,
    portugalHicpAnnualRate,
    portugalHousePriceIndex,
    portugalIndustrialProduction,
    portugalLongTermInterestRate,
    portugalMonthlyUnemployment,
    portugalQuarterlyGdp,
    portugalRetailTradeVolume,
    portugalTourismNights,
  ],
};
