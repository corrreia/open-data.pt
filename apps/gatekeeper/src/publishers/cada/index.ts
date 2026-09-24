import type { PublisherDefinition } from "#/catalog/define";
import { FEED as opinions2025 } from "./feeds/opinions-2025";

export const PUBLISHER: PublisherDefinition = {
  name: "CADA · Comissão de Acesso aos Documentos Administrativos",
  url: "https://www.cada.pt/",
  sources: ["dados.gov.pt"],
  logo: "png",
  feeds: [opinions2025],
};
