import type { PublisherDefinition } from "#/catalog/define";
import { FEED as portugueseMuseums } from "./feeds/portuguese-museums";
import { FEED as portugueseParishes } from "./feeds/portuguese-parishes";

export const PUBLISHER: PublisherDefinition = {
  name: "Arquivo.pt",
  url: "https://arquivo.pt/",
  sources: ["dados.gov.pt"],
  logo: "png",
  feeds: [portugueseMuseums, portugueseParishes],
};
