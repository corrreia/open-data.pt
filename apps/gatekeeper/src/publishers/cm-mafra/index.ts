import type { PublisherDefinition } from "#/catalog/define";
import { FEED as mafraAssociacoes } from "./feeds/mafra-associacoes";
import { FEED as mafraCentrosSaude } from "./feeds/mafra-centros-saude";
import { FEED as mafraCiclovias } from "./feeds/mafra-ciclovias";
import { FEED as mafraCircuitosPedestresBtt } from "./feeds/mafra-circuitos-pedestres-btt";
import { FEED as mafraEquipamentosEscolares } from "./feeds/mafra-equipamentos-escolares";
import { FEED as mafraEquipamentosSociais } from "./feeds/mafra-equipamentos-sociais";
import { FEED as mafraEspacosVerdes } from "./feeds/mafra-espacos-verdes";
import { FEED as mafraEstacionamentoBicicletas } from "./feeds/mafra-estacionamento-bicicletas";
import { FEED as mafraFarmacias } from "./feeds/mafra-farmacias";
import { FEED as mafraFontesPocosLavadouros } from "./feeds/mafra-fontes-pocos-lavadouros";
import { FEED as mafraFortes } from "./feeds/mafra-fortes";
import { FEED as mafraLinhasTorresPercursos } from "./feeds/mafra-linhas-torres-percursos";
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
    mafraAssociacoes,
    mafraCentrosSaude,
    mafraCiclovias,
    mafraCircuitosPedestresBtt,
    mafraEquipamentosEscolares,
    mafraEquipamentosSociais,
    mafraEspacosVerdes,
    mafraEstacionamentoBicicletas,
    mafraFarmacias,
    mafraFontesPocosLavadouros,
    mafraFortes,
    mafraLinhasTorresPercursos,
    mafraLugaresMobilidadeReduzida,
    mafraParcometros,
    mafraParquesCaninos,
    mafraParquesEstacionamento,
    mafraPatrimonioInventario,
    mafraPostosCarregamento,
    mafraPraias,
  ],
};
