import type { PublisherDefinition } from "#/catalog/define";
import { FEED as fuelTypes } from "./feeds/fuel-types";
import { FEED as gasoleoEspecial } from "./feeds/gasoleo-especial";
import { FEED as gasoleoSimples } from "./feeds/gasoleo-simples";
import { FEED as gasolina98 } from "./feeds/gasolina-98";
import { FEED as gasolinaSimples95 } from "./feeds/gasolina-simples-95";
import { FEED as gplAuto } from "./feeds/gpl-auto";

export const PUBLISHER: PublisherDefinition = {
  name: "DGEG · Direção-Geral de Energia e Geologia",
  url: "https://www.dgeg.gov.pt/",
  sources: ["precoscombustiveis.dgeg.gov.pt"],
  logo: "png",
  feeds: [
    // No Lisbon-district feed: its 37 stations are already in dgeg-gasolina-98, which covers the whole mainland.
    fuelTypes,
    gasoleoEspecial,
    gasoleoSimples,
    gasolina98,
    gasolinaSimples95,
    gplAuto,
  ],
};
