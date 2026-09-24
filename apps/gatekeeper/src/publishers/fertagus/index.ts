import type { PublisherDefinition } from "#/catalog/define";
import { FEED as gtfs } from "./feeds/gtfs";

export const PUBLISHER: PublisherDefinition = {
  name: "Fertagus",
  url: "https://www.fertagus.pt/",
  sources: ["www.fertagus.pt"],
  logo: "png",
  feeds: [gtfs],
};
