import type { PublisherDefinition } from "#/catalog/define";
import { FEED as gtfs } from "./feeds/gtfs";
import { FEED as portoStcpBusPositions } from "./feeds/porto-stcp-bus-positions";

export const PUBLISHER: PublisherDefinition = {
  name: "STCP",
  url: "https://www.stcp.pt/",
  sources: ["broker.fiware.urbanplatform.portodigital.pt", "dadosabertos.cm-porto.pt"],
  logo: "svg",
  feeds: [gtfs, portoStcpBusPositions],
};
