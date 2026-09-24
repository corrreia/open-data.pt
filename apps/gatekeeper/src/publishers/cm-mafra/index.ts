import type { PublisherDefinition } from "#/catalog/define";
import { FEED as mafraCentrosSaude } from "./feeds/mafra-centros-saude";
import { FEED as mafraCiclovias } from "./feeds/mafra-ciclovias";
import { FEED as mafraCircuitosPedestresBtt } from "./feeds/mafra-circuitos-pedestres-btt";
import { FEED as mafraEcopontosContentores } from "./feeds/mafra-ecopontos-contentores";
import { FEED as mafraEquipamentosCultura } from "./feeds/mafra-equipamentos-cultura";
import { FEED as mafraEquipamentosEscolares } from "./feeds/mafra-equipamentos-escolares";
import { FEED as mafraEquipamentosSociais } from "./feeds/mafra-equipamentos-sociais";
import { FEED as mafraEspacosJogoRecreio } from "./feeds/mafra-espacos-jogo-recreio";
import { FEED as mafraEspacosVerdes } from "./feeds/mafra-espacos-verdes";
import { FEED as mafraEstacionamentoBicicletas } from "./feeds/mafra-estacionamento-bicicletas";
import { FEED as mafraFarmacias } from "./feeds/mafra-farmacias";
import { FEED as mafraLugaresMobilidadeReduzida } from "./feeds/mafra-lugares-mobilidade-reduzida";
import { FEED as mafraParcometros } from "./feeds/mafra-parcometros";
import { FEED as mafraParquesCaninos } from "./feeds/mafra-parques-caninos";
import { FEED as mafraParquesEstacionamento } from "./feeds/mafra-parques-estacionamento";
import { FEED as mafraPatrimonioInventario } from "./feeds/mafra-patrimonio-inventario";
import { FEED as mafraPostosCarregamento } from "./feeds/mafra-postos-carregamento";
import { FEED as mafraPraias } from "./feeds/mafra-praias";

export const PUBLISHER: PublisherDefinition = {
  name: "Município de Mafra",
  url: "https://www.cm-mafra.pt/",
  sources: ["geomafra.cm-mafra.pt"],
  logo: "svg",
  feeds: [
    mafraCentrosSaude,
    mafraCiclovias,
    mafraCircuitosPedestresBtt,
    mafraEcopontosContentores,
    mafraEquipamentosCultura,
    mafraEquipamentosEscolares,
    mafraEquipamentosSociais,
    mafraEspacosJogoRecreio,
    mafraEspacosVerdes,
    mafraEstacionamentoBicicletas,
    mafraFarmacias,
    mafraLugaresMobilidadeReduzida,
    mafraParcometros,
    mafraParquesCaninos,
    mafraParquesEstacionamento,
    mafraPatrimonioInventario,
    mafraPostosCarregamento,
    mafraPraias,
  ],
};
