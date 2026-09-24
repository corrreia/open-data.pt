import type { PublisherDefinition } from "#/catalog/define";
import { FEED as gtfs } from "./feeds/gtfs";

export const PUBLISHER: PublisherDefinition = {
  name: "Horários do Funchal",
  url: "https://www.horariosdofunchal.pt/",
  sources: ["www.horariosdofunchal.pt"],
  logo: "png",
  feeds: [gtfs],
};
