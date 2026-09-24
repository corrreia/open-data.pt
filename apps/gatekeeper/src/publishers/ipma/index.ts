import type { PublisherDefinition } from "#/catalog/define";
import { FEED as dailyForecast } from "./feeds/daily-forecast";
import { FEED as fireRisk } from "./feeds/fire-risk";
import { FEED as municipalPrecipitation } from "./feeds/municipal-precipitation";
import { FEED as municipalTemperature } from "./feeds/municipal-temperature";
import { FEED as seaForecast } from "./feeds/sea-forecast";
import { FEED as seismic } from "./feeds/seismic";
import { FEED as shellfishRestrictions } from "./feeds/shellfish-restrictions";
import { FEED as stationObservations } from "./feeds/station-observations";
import { FEED as uvIndex } from "./feeds/uv-index";
import { FEED as weatherWarnings } from "./feeds/weather-warnings";

export const PUBLISHER: PublisherDefinition = {
  name: "IPMA · Instituto Português do Mar e da Atmosfera",
  url: "https://www.ipma.pt/",
  sources: ["api.ipma.pt"],
  logo: "svg",
  feeds: [dailyForecast, fireRisk, municipalPrecipitation, municipalTemperature, seaForecast, seismic, shellfishRestrictions, stationObservations, uvIndex, weatherWarnings],
};
