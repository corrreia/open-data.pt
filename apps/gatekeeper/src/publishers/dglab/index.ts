import type { PublisherDefinition } from "#/catalog/define";
import { FEED as publicLibraries2024 } from "./feeds/public-libraries-2024";

export const PUBLISHER: PublisherDefinition = {
  name: "DGLAB · Direção-Geral do Livro, dos Arquivos e das Bibliotecas",
  url: "https://www.dglab.gov.pt/",
  sources: ["dados.gov.pt"],
  logo: "png",
  feeds: [publicLibraries2024],
};
