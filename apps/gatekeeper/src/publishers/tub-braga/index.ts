import type { PublisherDefinition } from "#/catalog/define";
import { FEED as gtfs } from "./feeds/gtfs";

export const PUBLISHER: PublisherDefinition = {
  name: "TUB Braga",
  url: "https://www.tub.pt/",
  sources: ["www.tub.pt"],
  logo: "svg",
  feeds: [gtfs],
};
