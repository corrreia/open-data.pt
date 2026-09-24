import type { PublisherDefinition } from "#/catalog/define";
import { FEED as cadavalMunicipalWaste } from "./feeds/cadaval-municipal-waste";

export const PUBLISHER: PublisherDefinition = {
  name: "Município do Cadaval",
  url: "https://www.cm-cadaval.pt/",
  sources: ["dados.gov.pt"],
  logo: "svg",
  feeds: [cadavalMunicipalWaste],
};
