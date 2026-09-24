import type { PublisherDefinition } from "#/catalog/define";
import { FEED as effisPortugalRecentBurntAreas } from "./feeds/effis-portugal-recent-burnt-areas";

export const PUBLISHER: PublisherDefinition = {
  name: "EFFIS · European Forest Fire Information System, European Commission JRC",
  url: "https://forest-fire.emergency.copernicus.eu/",
  sources: ["maps.effis.emergency.copernicus.eu"],
  logo: "png",
  feeds: [effisPortugalRecentBurntAreas],
};
