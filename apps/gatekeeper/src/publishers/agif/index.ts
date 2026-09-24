import type { PublisherDefinition } from "#/catalog/define";
import { FEED as sgifrAppsAveiro } from "./feeds/sgifr-apps-aveiro";
import { FEED as sgifrAppsBeja } from "./feeds/sgifr-apps-beja";
import { FEED as sgifrAppsBraga } from "./feeds/sgifr-apps-braga";
import { FEED as sgifrAppsLeiria } from "./feeds/sgifr-apps-leiria";
import { FEED as sgifrAppsLisboa } from "./feeds/sgifr-apps-lisboa";
import { FEED as sgifrAppsPorto } from "./feeds/sgifr-apps-porto";
import { FEED as sgifrAppsSetubal } from "./feeds/sgifr-apps-setubal";
import { FEED as sgifrAppsViseu } from "./feeds/sgifr-apps-viseu";

export const PUBLISHER: PublisherDefinition = {
  name: "AGIF · Agência para a Gestão Integrada de Fogos Rurais",
  url: "https://www.agif.pt/",
  sources: ["api.sgifr.gov.pt"],
  logo: "svg",
  feeds: [sgifrAppsAveiro, sgifrAppsBeja, sgifrAppsBraga, sgifrAppsLeiria, sgifrAppsLisboa, sgifrAppsPorto, sgifrAppsSetubal, sgifrAppsViseu],
};
