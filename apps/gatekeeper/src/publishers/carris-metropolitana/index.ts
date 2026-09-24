import type { PublisherDefinition } from "#/catalog/define";
import { FEED as alerts } from "./feeds/alerts";
import { FEED as gtfs } from "./feeds/gtfs";
import { FEED as lines } from "./feeds/lines";
import { FEED as routes } from "./feeds/routes";
import { FEED as stops } from "./feeds/stops";
import { FEED as vehicles } from "./feeds/vehicles";

export const PUBLISHER: PublisherDefinition = {
  name: "Carris Metropolitana",
  url: "https://www.carrismetropolitana.pt/",
  sources: ["api.carrismetropolitana.pt"],
  logo: "svg",
  feeds: [alerts, gtfs, lines, routes, stops, vehicles],
};
