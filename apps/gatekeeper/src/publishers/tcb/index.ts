import type { PublisherDefinition } from "#/catalog/define";
import { FEED as barreiroGtfs } from "./feeds/barreiro-gtfs";

export const PUBLISHER: PublisherDefinition = {
  name: "Transportes Colectivos do Barreiro",
  url: "https://www.tcbarreiro.pt/",
  sources: ["backend.tcbarreiro.pt"],
  logo: "svg",
  feeds: [barreiroGtfs],
};
