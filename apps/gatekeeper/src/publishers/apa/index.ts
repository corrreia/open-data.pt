import type { PublisherDefinition } from "#/catalog/define";
import { FEED as airQualityStations } from "./feeds/air-quality-stations";
import { FEED as bathingBeaches } from "./feeds/bathing-beaches";
import { FEED as blueFlagBeaches } from "./feeds/blue-flag-beaches";
import { FEED as bathingWaters } from "./feeds/bathing-waters";
import { FEED as emissionsTradingInstallations } from "./feeds/emissions-trading-installations";
import { FEED as floodMarks } from "./feeds/flood-marks";
import { FEED as hydrometricStations } from "./feeds/hydrometric-stations";
import { FEED as droughtIndex } from "./feeds/drought-index";
import { FEED as floodAlerts } from "./feeds/flood-alerts";
import { FEED as meteorologicalStations } from "./feeds/meteorological-stations";
import { FEED as radnetStations } from "./feeds/radnet-stations";
import { FEED as sevesoEstablishments } from "./feeds/seveso-establishments";
import { FEED as groundwaterState } from "./feeds/groundwater-state";
import { FEED as monthlyPrecipitation } from "./feeds/monthly-precipitation";
import { FEED as reservoirBasins } from "./feeds/reservoir-basins";
import { FEED as airTemperature } from "./feeds/air-temperature";
import { FEED as groundwaterLevels } from "./feeds/groundwater-levels";
import { FEED as precipitation } from "./feeds/precipitation";
import { FEED as relativeHumidity } from "./feeds/relative-humidity";
import { FEED as reservoirLevels } from "./feeds/reservoir-levels";
import { FEED as reservoirStorage } from "./feeds/reservoir-storage";
import { FEED as riverFlows } from "./feeds/river-flows";
import { FEED as riverLevels } from "./feeds/river-levels";
import { FEED as windSpeed } from "./feeds/wind-speed";

export const PUBLISHER: PublisherDefinition = {
  name: "APA · Agência Portuguesa do Ambiente",
  url: "https://apambiente.pt/",
  sources: [
    "infoagua.apambiente.pt",
    "sniambgeoogc.apambiente.pt",
    // One export of 50 stations takes this PHP site up to 15 seconds, and our history walk once had it answering
    // us nonstop until APA blocked our User-Agent (docs/publishers/apa.md): no more than one request every five
    // seconds, under a common browser's name.
    {
      host: "snirh.apambiente.pt",
      minIntervalSeconds: 5,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    },
  ],
  logo: "png",
  feeds: [
    airQualityStations,
    bathingBeaches,
    blueFlagBeaches,
    bathingWaters,
    emissionsTradingInstallations,
    floodMarks,
    hydrometricStations,
    droughtIndex,
    floodAlerts,
    meteorologicalStations,
    radnetStations,
    sevesoEstablishments,
    groundwaterState,
    monthlyPrecipitation,
    reservoirBasins,
    airTemperature,
    groundwaterLevels,
    precipitation,
    relativeHumidity,
    reservoirLevels,
    reservoirStorage,
    riverFlows,
    riverLevels,
    windSpeed,
  ],
};
