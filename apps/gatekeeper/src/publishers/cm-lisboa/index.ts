import type { PublisherDefinition } from "#/catalog/define";
import { FEED as lisbonBuildingPermits } from "./feeds/lisbon-building-permits";
import { FEED as lisbonCleaningDepots } from "./feeds/lisbon-cleaning-depots";
import { FEED as lisboaEcoilhasSubterraneas } from "./feeds/lisboa-ecoilhas-subterraneas";
import { FEED as lisbonFireStations } from "./feeds/lisbon-fire-stations";
import { FEED as lisbonHealthCentres } from "./feeds/lisbon-health-centres";
import { FEED as lisbonPharmacies } from "./feeds/lisbon-pharmacies";
import { FEED as lisbonPublicHospitals } from "./feeds/lisbon-public-hospitals";
import { FEED as lisbonHotels } from "./feeds/lisbon-hotels";
import { FEED as lisbonLibrariesArchives } from "./feeds/lisbon-libraries-archives";
import { FEED as lisbonLoraNetwork } from "./feeds/lisbon-lora-network";
import { FEED as lisbonMetroStations } from "./feeds/lisbon-metro-stations";
import { FEED as lisbonMicromobilityRestrictions } from "./feeds/lisbon-micromobility-restrictions";
import { FEED as lisbonMuseums } from "./feeds/lisbon-museums";
import { FEED as lisbonParishes } from "./feeds/lisbon-parishes";
import { FEED as lisboaParquesCaninos } from "./feeds/lisboa-parques-caninos";
import { FEED as lisboaParquesInfantis } from "./feeds/lisboa-parques-infantis";
import { FEED as lisbonPrimarySchools } from "./feeds/lisbon-primary-schools";
import { FEED as lisbonPspPoliceStations } from "./feeds/lisbon-psp-police-stations";
import { FEED as lisbonRecyclingPoints } from "./feeds/lisbon-recycling-points";
import { FEED as lisboaRedeCiclavel } from "./feeds/lisboa-rede-ciclavel";
import { FEED as lisbonSignalisedCrossings } from "./feeds/lisbon-signalised-crossings";
import { FEED as lisbonSpeedCameras } from "./feeds/lisbon-speed-cameras";
import { FEED as lisbonVariableMessageSigns } from "./feeds/lisbon-variable-message-signs";
import { FEED as lisbonSportsFacilities } from "./feeds/lisbon-sports-facilities";
import { FEED as lisbonTemporaryOccupations } from "./feeds/lisbon-temporary-occupations";
import { FEED as lisbonTreeIncidents } from "./feeds/lisbon-tree-incidents";
import { FEED as lisbonTukTukParking } from "./feeds/lisbon-tuk-tuk-parking";
import { FEED as lisbonUrgentWorks } from "./feeds/lisbon-urgent-works";

export const PUBLISHER: PublisherDefinition = {
  name: "Câmara Municipal de Lisboa",
  url: "https://www.lisboa.pt/",
  sources: ["services.arcgis.com"],
  logo: "svg",
  feeds: [
    lisbonBuildingPermits,
    lisbonCleaningDepots,
    lisboaEcoilhasSubterraneas,
    lisbonFireStations,
    /*
     * The health-centre dataset is read by three feeds — centres, pharmacies and
     * hospitals are three layers of one service, keyed and served alike — so each
     * says what it is within it.
     */
    lisbonHealthCentres,
    lisbonPharmacies,
    lisbonPublicHospitals,
    lisbonHotels,
    lisbonLibrariesArchives,
    lisbonLoraNetwork,
    lisbonMetroStations,
    lisbonMicromobilityRestrictions,
    lisbonMuseums,
    lisbonParishes,
    lisboaParquesCaninos,
    lisboaParquesInfantis,
    lisbonPrimarySchools,
    lisbonPspPoliceStations,
    lisbonRecyclingPoints,
    lisboaRedeCiclavel,
    lisbonSignalisedCrossings,
    /*
     * The radars and the message panels are two layers of one service, and one
     * dataset: each says which of the two it is.
     */
    lisbonSpeedCameras,
    lisbonVariableMessageSigns,
    lisbonSportsFacilities,
    lisbonTemporaryOccupations,
    lisbonTreeIncidents,
    lisbonTukTukParking,
    lisbonUrgentWorks,
  ],
};
