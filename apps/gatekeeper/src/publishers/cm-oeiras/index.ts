import type { PublisherDefinition } from "#/catalog/define";
import { FEED as oeirasCiclovias } from "./feeds/oeiras-ciclovias";
import { FEED as oeirasColoniasErrantes } from "./feeds/oeiras-colonias-errantes";
import { FEED as oeirasCondicionalismosViaPublica } from "./feeds/oeiras-condicionalismos-via-publica";
import { FEED as oeirasDocasBicicletas } from "./feeds/oeiras-docas-bicicletas";
import { FEED as oeirasEquipamentosSaude } from "./feeds/oeiras-equipamentos-saude";
import { FEED as oeirasEspacosVerdes } from "./feeds/oeiras-espacos-verdes";
import { FEED as oeirasEstabelecimentosDesocupados } from "./feeds/oeiras-estabelecimentos-desocupados";
import { FEED as oeirasHortasUrbanas } from "./feeds/oeiras-hortas-urbanas";
import { FEED as oeirasHourlyEnvironment } from "./feeds/oeiras-hourly-environment";
import { FEED as oeirasObrasMunicipais } from "./feeds/oeiras-obras-municipais";
import { FEED as oeirasOrcamentoParticipativo } from "./feeds/oeiras-orcamento-participativo";
import { FEED as oeirasParquimetros } from "./feeds/oeiras-parquimetros";
import { FEED as oeirasPontosCarregamento } from "./feeds/oeiras-pontos-carregamento";
import { FEED as oeirasResiduosIndiferenciados } from "./feeds/oeiras-residuos-indiferenciados";

export const PUBLISHER: PublisherDefinition = {
  name: "Câmara Municipal de Oeiras",
  url: "https://www.oeiras.pt/",
  sources: ["oeirasinterativa.oeiras.pt"],
  logo: "png",
  feeds: [
    oeirasCiclovias,
    oeirasColoniasErrantes,
    oeirasCondicionalismosViaPublica,
    oeirasDocasBicicletas,
    oeirasEquipamentosSaude,
    oeirasEspacosVerdes,
    oeirasEstabelecimentosDesocupados,
    oeirasHortasUrbanas,
    oeirasHourlyEnvironment,
    oeirasObrasMunicipais,
    oeirasOrcamentoParticipativo,
    oeirasParquimetros,
    oeirasPontosCarregamento,
    oeirasResiduosIndiferenciados,
  ],
};
