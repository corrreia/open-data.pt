import type { PublisherDefinition } from "#/catalog/define";
import { FEED as gtfs } from "./feeds/gtfs";

export const PUBLISHER: PublisherDefinition = {
  name: "Metro do Porto",
  url: "https://www.metrodoporto.pt/",
  sources: ["www.metrodoporto.pt"],
  logo: "svg",
  feeds: [gtfs],
};
