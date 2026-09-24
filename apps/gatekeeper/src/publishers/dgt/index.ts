import type { PublisherDefinition } from "#/catalog/define";
import { FEED as caopAcoresCentralOrientalFreguesias } from "./feeds/caop-acores-central-oriental-freguesias";
import { FEED as caopAcoresCentralOrientalMunicipios } from "./feeds/caop-acores-central-oriental-municipios";
import { FEED as caopAcoresOcidentalFreguesias } from "./feeds/caop-acores-ocidental-freguesias";
import { FEED as caopAcoresOcidentalMunicipios } from "./feeds/caop-acores-ocidental-municipios";
import { FEED as caopDistritos } from "./feeds/caop-distritos";
import { FEED as caopFreguesias } from "./feeds/caop-freguesias";
import { FEED as caopMunicipios } from "./feeds/caop-municipios";
import { FEED as caopNuts2 } from "./feeds/caop-nuts2";
import { FEED as caopNuts3 } from "./feeds/caop-nuts3";
import { FEED as caopTrocos } from "./feeds/caop-trocos";
import { FEED as caopMadeiraFreguesias } from "./feeds/caop-madeira-freguesias";
import { FEED as caopMadeiraMunicipios } from "./feeds/caop-madeira-municipios";
import { FEED as crus } from "./feeds/crus";
import { FEED as crusOutlines } from "./feeds/crus-shapes";
import { FEED as fototecaIndex } from "./feeds/fototeca-index";
import { FEED as rgnRedeGravimetrica } from "./feeds/rgn-rede-gravimetrica";
import { FEED as rgnRedeMaregrafica } from "./feeds/rgn-rede-maregrafica";
import { FEED as rgnRedeNivelamento } from "./feeds/rgn-rede-nivelamento";
import { FEED as rgnRenepEstacoes } from "./feeds/rgn-renep-estacoes";
import { FEED as rgnVerticesGeodesicos } from "./feeds/rgn-vertices-geodesicos";
import { FEED as serrasCumesPrincipais } from "./feeds/serras-cumes-principais";
import { FEED as serrasPrincipais } from "./feeds/serras-principais";
import { FEED as serrasToponimicas } from "./feeds/serras-toponimicas";
import { FEED as sgifrPontos } from "./feeds/sgifr-pontos";
import { FEED as snitMedidasPreventivas } from "./feeds/snit-medidas-preventivas";
import { FEED as snitPaap } from "./feeds/snit-paap";
import { FEED as snitPaqat } from "./feeds/snit-paqat";
import { FEED as snitPdm } from "./feeds/snit-pdm";
import { FEED as snitPeap } from "./feeds/snit-peap";
import { FEED as snitPfn } from "./feeds/snit-pfn";
import { FEED as snitPgrh } from "./feeds/snit-pgrh";
import { FEED as snitPgri } from "./feeds/snit-pgri";
import { FEED as snitPiot } from "./feeds/snit-piot";
import { FEED as snitPna } from "./feeds/snit-pna";
import { FEED as snitPnpot } from "./feeds/snit-pnpot";
import { FEED as snitPoaap } from "./feeds/snit-poaap";
import { FEED as snitPoap } from "./feeds/snit-poap";
import { FEED as snitPoc } from "./feeds/snit-poc";
import { FEED as snitPooc } from "./feeds/snit-pooc";
import { FEED as snitPp } from "./feeds/snit-pp";
import { FEED as snitPrgp } from "./feeds/snit-prgp";
import { FEED as snitPrn } from "./feeds/snit-prn";
import { FEED as snitProf } from "./feeds/snit-prof";
import { FEED as snitProtPlano } from "./feeds/snit-prot-plano";
import { FEED as snitProtPrograma } from "./feeds/snit-prot-programa";
import { FEED as snitPszaer } from "./feeds/snit-pszaer";
import { FEED as snitPu } from "./feeds/snit-pu";
import { FEED as snitRedeNatura } from "./feeds/snit-rede-natura";
import { FEED as srupAeronautica } from "./feeds/srup-aeronautica";
import { FEED as srupAlbufeiras } from "./feeds/srup-albufeiras";
import { FEED as srupAreasProtegidas } from "./feeds/srup-areas-protegidas";
import { FEED as srupArvoresInteressePublicoAreas } from "./feeds/srup-arvores-interesse-publico-areas";
import { FEED as srupArvoresInteressePublicoPontos } from "./feeds/srup-arvores-interesse-publico-pontos";
import { FEED as srupCaptacoesAguasSubterraneas } from "./feeds/srup-captacoes-aguas-subterraneas";
import { FEED as srupDefesaNacional } from "./feeds/srup-defesa-nacional";
import { FEED as srupDefesaNacionalZonas } from "./feeds/srup-defesa-nacional-zonas";
import { FEED as srupEstacoesFerroviarias } from "./feeds/srup-estacoes-ferroviarias";
import { FEED as srupMarcosGeodesicos } from "./feeds/srup-marcos-geodesicos";
import { FEED as srupRedeEletrica } from "./feeds/srup-rede-eletrica";
import { FEED as srupRedeFerroviaria } from "./feeds/srup-rede-ferroviaria";
import { FEED as srupRedeNaturaZec } from "./feeds/srup-rede-natura-zec";
import { FEED as srupRedeNaturaZpe } from "./feeds/srup-rede-natura-zpe";
import { FEED as srupRedeRodoviaria } from "./feeds/srup-rede-rodoviaria";
import { FEED as srupReservaAgricola } from "./feeds/srup-reserva-agricola";
import { FEED as srupReservaEcologicaAreas } from "./feeds/srup-reserva-ecologica-areas";
import { FEED as srupReservaEcologicaLinhas } from "./feeds/srup-reserva-ecologica-linhas";

export const PUBLISHER: PublisherDefinition = {
  name: "DGT · Direção-Geral do Território",
  url: "https://www.dgterritorio.gov.pt/",
  sources: ["geo2.dgterritorio.gov.pt", "ogcapi.dgterritorio.gov.pt", "snit-sgt.dgterritorio.gov.pt"],
  logo: "png",
  feeds: [
    caopAcoresCentralOrientalFreguesias,
    caopAcoresCentralOrientalMunicipios,
    caopAcoresOcidentalFreguesias,
    caopAcoresOcidentalMunicipios,
    /*
     * DGT publishes the CAOP for Portugal Continental only: 18 districts, 278
     * municipalities and 3,049 parishes, with the Azores and Madeira absent from
     * these collections. Every title and description says so.
     *
     * What each feed does with its outlines was decided by reading it. The
     * parishes and the boundary segments are drawn, because no parish reaches the
     * megabyte a record may hold and they are what almost everything else joins
     * to. The districts, municipalities and NUTS regions are placed instead: each
     * of those layers holds outlines past that megabyte — one district is three
     * and a half of them — and they are in any case the parishes added together,
     * so nothing is lost that cannot be rebuilt from the parishes that are drawn.
     * Placing still means downloading the outline and keeping what says where the
     * area is and how far it reaches; the service offers no way to ask for less.
     *
     * The `admin` collection is deliberately not read. It holds the same 3,049
     * parishes split into their 3,392 disjoint parts: an island parish and its
     * mainland part become two rows carrying one parish's code, name, municipality
     * and NUTS levels. The parish feed now publishes each parish's whole outline,
     * multipart and all, so `admin` would republish every one of those columns a
     * second time to say something the geometry already says.
     *
     * `nuts1` is not read either: it is a single row, "Continente", whose columns
     * are the other tables added up.
     *
     * Every feed's budgets come from having read its layer, polled every week: the
     * CAOP is republished as a dated edition, not continuously, so weekly is
     * frequent enough to catch a correction.
     */
    caopDistritos,
    caopFreguesias,
    caopMunicipios,
    caopNuts2,
    caopNuts3,
    caopTrocos,
    caopMadeiraFreguesias,
    caopMadeiraMunicipios,
    crus,
    crusOutlines,
    fototecaIndex,
    rgnRedeGravimetrica,
    rgnRedeMaregrafica,
    rgnRedeNivelamento,
    rgnRenepEstacoes,
    rgnVerticesGeodesicos,
    serrasCumesPrincipais,
    serrasPrincipais,
    serrasToponimicas,
    sgifrPontos,
    snitMedidasPreventivas,
    snitPaap,
    snitPaqat,
    snitPdm,
    snitPeap,
    snitPfn,
    snitPgrh,
    snitPgri,
    snitPiot,
    snitPna,
    snitPnpot,
    snitPoaap,
    snitPoap,
    snitPoc,
    snitPooc,
    snitPp,
    snitPrgp,
    snitPrn,
    snitProf,
    snitProtPlano,
    snitProtPrograma,
    snitPszaer,
    snitPu,
    snitRedeNatura,
    srupAeronautica,
    srupAlbufeiras,
    srupAreasProtegidas,
    srupArvoresInteressePublicoAreas,
    srupArvoresInteressePublicoPontos,
    srupCaptacoesAguasSubterraneas,
    srupDefesaNacional,
    srupDefesaNacionalZonas,
    srupEstacoesFerroviarias,
    srupMarcosGeodesicos,
    srupRedeEletrica,
    srupRedeFerroviaria,
    srupRedeNaturaZec,
    srupRedeNaturaZpe,
    srupRedeRodoviaria,
    srupReservaAgricola,
    srupReservaEcologicaAreas,
    srupReservaEcologicaLinhas,
  ],
};
