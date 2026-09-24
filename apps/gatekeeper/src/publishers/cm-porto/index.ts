import type { PublisherDefinition } from "#/catalog/define";
import { FEED as portoCulturalAgenda } from "./feeds/porto-cultural-agenda";
import { FEED as portoLoadingZones } from "./feeds/porto-loading-zones";
import { FEED as portoMunicipalParking } from "./feeds/porto-municipal-parking";
import { FEED as portoMunicipalTrees } from "./feeds/porto-municipal-trees";
import { FEED as portoSharedMicromobilitySpots } from "./feeds/porto-shared-micromobility-spots";

export const PUBLISHER: PublisherDefinition = {
  name: "Câmara Municipal do Porto",
  url: "https://www.cm-porto.pt/",
  sources: ["broker.fiware.urbanplatform.portodigital.pt", "dadosabertos.cm-porto.pt"],
  logo: "svg",
  feeds: [portoCulturalAgenda, portoLoadingZones, portoMunicipalParking, portoMunicipalTrees, portoSharedMicromobilitySpots],
};
