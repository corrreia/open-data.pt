import type { PublisherDefinition } from "#/catalog/define";
import { FEED as gtfs } from "./feeds/gtfs";
import { FEED as headways } from "./feeds/headways";
import { FEED as lineStatus } from "./feeds/line-status";
import { FEED as stations } from "./feeds/stations";
import { FEED as waitingTimes } from "./feeds/waiting-times";

export const PUBLISHER: PublisherDefinition = {
  name: "Metropolitano de Lisboa",
  url: "https://www.metrolisboa.pt/",
  sources: ["api.metrolisboa.pt", "dados.gov.pt", "lisboa-metro.open-data.pt"],
  logo: "png",
  feeds: [gtfs, headways, lineStatus, stations, waitingTimes],
};
