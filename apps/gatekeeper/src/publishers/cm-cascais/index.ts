import type { PublisherDefinition } from "#/catalog/define";
import { FEED as cascaisAllotments } from "./feeds/cascais-allotments";
import { FEED as cascaisBeaches } from "./feeds/cascais-beaches";
import { FEED as cascaisBusStops } from "./feeds/cascais-bus-stops";
import { FEED as cascaisCommerceServices } from "./feeds/cascais-commerce-services";
import { FEED as cascaisCulturalVenues } from "./feeds/cascais-cultural-venues";
import { FEED as cascaisCyclePaths } from "./feeds/cascais-cycle-paths";
import { FEED as cascaisDefibrillators } from "./feeds/cascais-defibrillators";
import { FEED as cascaisDrinkingFountains } from "./feeds/cascais-drinking-fountains";
import { FEED as cascaisFireInfrastructure } from "./feeds/cascais-fire-infrastructure";
import { FEED as cascaisFireStations } from "./feeds/cascais-fire-stations";
import { FEED as cascaisForestFires } from "./feeds/cascais-forest-fires";
import { FEED as cascaisGreenSpaces } from "./feeds/cascais-green-spaces";
import { FEED as cascaisHealthFacilities } from "./feeds/cascais-health-facilities";
import { FEED as cascaisHotels } from "./feeds/cascais-hotels";
import { FEED as cascaisMarkets } from "./feeds/cascais-markets";
import { FEED as cascaisMunicipalHousing } from "./feeds/cascais-municipal-housing";
import { FEED as cascaisParking } from "./feeds/cascais-parking";
import { FEED as cascaisPharmacies } from "./feeds/cascais-pharmacies";
import { FEED as cascaisPlaygrounds } from "./feeds/cascais-playgrounds";
import { FEED as cascaisPublicSchools } from "./feeds/cascais-public-schools";
import { FEED as cascaisRentalKiosks } from "./feeds/cascais-rental-kiosks";
import { FEED as cascaisSharedMobilityStations } from "./feeds/cascais-shared-mobility-stations";
import { FEED as cascaisSocialCharter } from "./feeds/cascais-social-charter";
import { FEED as cascaisSportsFacilities } from "./feeds/cascais-sports-facilities";
import { FEED as cascaisStreetTrees } from "./feeds/cascais-street-trees";
import { FEED as cascaisTaxiRanks } from "./feeds/cascais-taxi-ranks";
import { FEED as cascaisTrainStations } from "./feeds/cascais-train-stations";
import { FEED as cascaisTsunamiMeetingPoints } from "./feeds/cascais-tsunami-meeting-points";

export const PUBLISHER: PublisherDefinition = {
  name: "Câmara Municipal de Cascais",
  url: "https://www.cascais.pt/",
  sources: ["dadosabertos.cascais.pt"],
  logo: "png",
  feeds: [
    cascaisAllotments,
    cascaisBeaches,
    cascaisBusStops,
    cascaisCommerceServices,
    cascaisCulturalVenues,
    cascaisCyclePaths,
    cascaisDefibrillators,
    cascaisDrinkingFountains,
    cascaisFireInfrastructure,
    cascaisFireStations,
    cascaisForestFires,
    cascaisGreenSpaces,
    cascaisHealthFacilities,
    cascaisHotels,
    cascaisMarkets,
    cascaisMunicipalHousing,
    cascaisParking,
    cascaisPharmacies,
    cascaisPlaygrounds,
    cascaisPublicSchools,
    cascaisRentalKiosks,
    cascaisSharedMobilityStations,
    cascaisSocialCharter,
    cascaisSportsFacilities,
    cascaisStreetTrees,
    cascaisTaxiRanks,
    cascaisTrainStations,
    cascaisTsunamiMeetingPoints,
  ],
};
