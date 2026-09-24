import type { PublisherDefinition } from "#/catalog/define";
import { FEED as azoresEarthquakes } from "./feeds/azores-earthquakes";
import { FEED as madeiraEarthquakes } from "./feeds/madeira-earthquakes";
import { FEED as mainlandPortugalEarthquakes } from "./feeds/mainland-portugal-earthquakes";

export const PUBLISHER: PublisherDefinition = {
  name: "USGS · U.S. Geological Survey",
  url: "https://www.usgs.gov/",
  sources: ["earthquake.usgs.gov"],
  logo: "svg",
  feeds: [azoresEarthquakes, madeiraEarthquakes, mainlandPortugalEarthquakes],
};
