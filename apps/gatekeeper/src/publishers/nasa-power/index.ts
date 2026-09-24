import type { PublisherDefinition } from "#/catalog/define";
import { FEED as azores } from "./feeds/azores";
import { FEED as madeira } from "./feeds/madeira";
import { FEED as mainland } from "./feeds/mainland";

export const PUBLISHER: PublisherDefinition = {
  name: "NASA POWER · Prediction Of Worldwide Energy Resources",
  url: "https://power.larc.nasa.gov/",
  sources: ["power.larc.nasa.gov"],
  logo: "svg",
  feeds: [azores, madeira, mainland],
};
