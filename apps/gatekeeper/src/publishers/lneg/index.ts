import type { PublisherDefinition } from "#/catalog/define";
import { FEED as falhasGeologicas } from "./feeds/falhas-geologicas";
import { FEED as ocorrenciasMinerais } from "./feeds/ocorrencias-minerais";
import { FEED as pontosDeAgua } from "./feeds/pontos-de-agua";
import { FEED as sistemasAquiferos } from "./feeds/sistemas-aquiferos";
import { FEED as sondagens } from "./feeds/sondagens";

export const PUBLISHER: PublisherDefinition = {
  name: "LNEG · Laboratório Nacional de Energia e Geologia",
  url: "https://www.lneg.pt/",
  sources: ["ogcapi.lneg.pt"],
  logo: "png",
  feeds: [falhasGeologicas, ocorrenciasMinerais, pontosDeAgua, sistemasAquiferos, sondagens],
};
