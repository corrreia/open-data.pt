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
import { FEED as reservoirFlows } from "./feeds/reservoir-flows";
import { FEED as reservoirs } from "./feeds/reservoirs";
import { FEED as meteorologicalStations } from "./feeds/meteorological-stations";
import { FEED as radnetStations } from "./feeds/radnet-stations";
import { FEED as sevesoEstablishments } from "./feeds/seveso-establishments";
import { FEED as groundwaterState } from "./feeds/groundwater-state";
import { FEED as monthlyPrecipitation } from "./feeds/monthly-precipitation";
import { FEED as reservoirBasins } from "./feeds/reservoir-basins";
import { FEED as airTemperature } from "./feeds/air-temperature";
import { FEED as precipitation } from "./feeds/precipitation";
import { FEED as relativeHumidity } from "./feeds/relative-humidity";
import { FEED as reservoirLevels } from "./feeds/reservoir-levels";
import { FEED as reservoirStorage } from "./feeds/reservoir-storage";
import { FEED as riverFlows } from "./feeds/river-flows";
import { FEED as riverLevels } from "./feeds/river-levels";
import { FEED as radioactivityAir } from "./feeds/radioactivity-air";
import { FEED as radioactivityWater } from "./feeds/radioactivity-water";
import { FEED as radioactivityAerosols } from "./feeds/radioactivity-aerosols";
import { FEED as beachOccupancy } from "./feeds/beach-occupancy";
import { FEED as landfills } from "./feeds/landfills";
import { FEED as mediumCombustionPlants } from "./feeds/medium-combustion-plants";
import { FEED as impactAssessmentProjects } from "./feeds/impact-assessment-projects";
import { FEED as emasOrganisations } from "./feeds/emas-organisations";
import { FEED as wasteInfrastructure } from "./feeds/waste-infrastructure";
import { FEED as wasteOperators } from "./feeds/waste-operators";
import { FEED as airQuality } from "./feeds/air-quality";
import { FEED as tyreCollectionPoints } from "./feeds/tyre-collection-points";
import { FEED as drinkingWaterProtectionAreas } from "./feeds/drinking-water-protection-areas";
import { FEED as surfaceWaterQualityStations } from "./feeds/surface-water-quality-stations";
import { FEED as groundwaterQualityStations } from "./feeds/groundwater-quality-stations";
import { FEED as groundwaterQuantityStations } from "./feeds/groundwater-quantity-stations";
import { FEED as riverWaterBodies } from "./feeds/river-water-bodies";
import { FEED as publicLagoons } from "./feeds/public-lagoons";

/** A common Chrome's name: every APA server but InfoÁgua returns 520 to a Worker under ours. */
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export const PUBLISHER: PublisherDefinition = {
  name: "APA · Agência Portuguesa do Ambiente",
  url: "https://apambiente.pt/",
  sources: [
    // A live collection of river levels or rain reads about ninety station pages of this small app: one a second.
    { host: "infoagua.apambiente.pt", minIntervalSeconds: 1 },
    // APA's ArcGIS servers, like QualAr and SNIRH below, return 520 to a Worker under our name and answer a browser's
    // (checked 11 November 2026; docs/publishers/apa.md).
    { host: "sniambgeoogc.apambiente.pt", userAgent: BROWSER },
    { host: "inspire.apambiente.pt", userAgent: BROWSER },
    // QualAr shares its server with SNIRH, which blocked our name after a busy history walk: at most one request every
    // five seconds, under a browser's name.
    { host: "qualar.apambiente.pt", minIntervalSeconds: 5, userAgent: BROWSER },
    // One export of 50 stations takes this PHP site up to 15 seconds, and our history walk once had it answering
    // us nonstop until APA blocked our User-Agent (docs/publishers/apa.md): no more than one request every five
    // seconds, under a common browser's name.
    {
      host: "snirh.apambiente.pt",
      minIntervalSeconds: 5,
      userAgent: BROWSER,
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
    reservoirs,
    reservoirFlows,
    meteorologicalStations,
    radnetStations,
    sevesoEstablishments,
    groundwaterState,
    monthlyPrecipitation,
    reservoirBasins,
    airTemperature,
    precipitation,
    relativeHumidity,
    reservoirLevels,
    reservoirStorage,
    riverFlows,
    riverLevels,
    radioactivityAir,
    radioactivityWater,
    radioactivityAerosols,
    beachOccupancy,
    landfills,
    mediumCombustionPlants,
    impactAssessmentProjects,
    emasOrganisations,
    wasteInfrastructure,
    wasteOperators,
    airQuality,
    tyreCollectionPoints,
    drinkingWaterProtectionAreas,
    surfaceWaterQualityStations,
    groundwaterQualityStations,
    groundwaterQuantityStations,
    riverWaterBodies,
    publicLagoons,
  ],
};
