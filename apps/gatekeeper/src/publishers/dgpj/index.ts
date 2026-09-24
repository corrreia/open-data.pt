import type { PublisherDefinition } from "#/catalog/define";
import { FEED as justiceFacilities } from "./feeds/justice-facilities";

export const PUBLISHER: PublisherDefinition = {
  name: "DGPJ · Direção-Geral da Política de Justiça",
  url: "https://dgpj.justica.gov.pt/",
  sources: ["dados.gov.pt"],
  logo: "png",
  feeds: [justiceFacilities],
};
