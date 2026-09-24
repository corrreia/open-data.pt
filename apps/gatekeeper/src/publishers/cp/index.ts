import type { PublisherDefinition } from "#/catalog/define";
import { FEED as gtfs } from "./feeds/gtfs";

export const PUBLISHER: PublisherDefinition = {
  name: "CP",
  url: "https://www.cp.pt/",
  sources: ["publico.cp.pt"],
  logo: "svg",
  feeds: [gtfs],
};
