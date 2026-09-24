import type { PublisherDefinition } from "#/catalog/define";
import { FEED as azores } from "./feeds/azores";
import { FEED as madeira } from "./feeds/madeira";
import { FEED as mainland } from "./feeds/mainland";

export const PUBLISHER: PublisherDefinition = {
  name: "NASA FIRMS · Fire Information for Resource Management System",
  url: "https://firms.modaps.eosdis.nasa.gov/",
  sources: ["firms.modaps.eosdis.nasa.gov"],
  logo: "png",
  feeds: [azores, madeira, mainland],
};
