/**
 * The catalog's publishers: the vocabulary of institutions and operators whose
 * data is served, one key each, so a publisher read through two libraries or
 * found on two portals is one publisher on the site. A feed names one by key;
 * a key outside this list is a mistake the type system and a test catch.
 *
 * A publisher is who made the data, never where it was read: dados.gov.pt
 * carries ten of these and is none of them.
 */
export interface PublisherDescription {
  /** The name as a heading shows it: an acronym and what it stands for, or the operator's name. */
  name: string;
  /** The publisher's own site, not the portal the data was read from. */
  url?: string;
}

export const PUBLISHERS = {
  "apa": { name: "APA · Agência Portuguesa do Ambiente", url: "https://apambiente.pt/" },
  "arquivo-pt": { name: "Arquivo.pt", url: "https://arquivo.pt/" },
  "arte": { name: "ARTE · Agência para a Reforma Tecnológica do Estado" },
  "assembleia-da-republica": { name: "Assembleia da República", url: "https://www.parlamento.pt/" },
  "banco-de-portugal": { name: "Banco de Portugal", url: "https://www.bportugal.pt/" },
  "barraqueiro-oeste": { name: "Barraqueiro Oeste" },
  "bird": { name: "Bird", url: "https://www.bird.co/" },
  "boa-viagem": { name: "Boa Viagem" },
  "bora": { name: "Bora" },
  "cada": { name: "CADA · Comissão de Acesso aos Documentos Administrativos", url: "https://www.cada.pt/" },
  "carris-metropolitana": { name: "Carris Metropolitana", url: "https://www.carrismetropolitana.pt/" },
  "cm-agueda": { name: "Câmara Municipal de Águeda", url: "https://www.cm-agueda.pt/" },
  "cm-cadaval": { name: "Município do Cadaval", url: "https://www.cm-cadaval.pt/" },
  "cm-cascais": { name: "Câmara Municipal de Cascais", url: "https://www.cascais.pt/" },
  "cm-lisboa": { name: "Câmara Municipal de Lisboa", url: "https://www.lisboa.pt/" },
  "cm-oeiras": { name: "Câmara Municipal de Oeiras", url: "https://www.oeiras.pt/" },
  "cm-porto": { name: "Câmara Municipal do Porto", url: "https://www.cm-porto.pt/" },
  "cp": { name: "CP", url: "https://www.cp.pt/" },
  "demarca-design": { name: "DEMARCA Design" },
  "dgeg": { name: "DGEG · Direção-Geral de Energia e Geologia", url: "https://www.dgeg.gov.pt/" },
  "dglab": { name: "DGLAB · Direção-Geral do Livro, dos Arquivos e das Bibliotecas", url: "https://www.dglab.gov.pt/" },
  "dgpj": { name: "DGPJ · Direção-Geral da Política de Justiça", url: "https://dgpj.justica.gov.pt/" },
  "dgs": { name: "DGS · Direção-Geral da Saúde", url: "https://www.dgs.pt/" },
  "dgt": { name: "DGT · Direção-Geral do Território", url: "https://www.dgterritorio.gov.pt/" },
  "e-redes": { name: "E-REDES", url: "https://www.e-redes.pt/" },
  "eurostat": { name: "Eurostat", url: "https://ec.europa.eu/eurostat" },
  "fertagus": { name: "Fertagus", url: "https://www.fertagus.pt/" },
  "horarios-do-funchal": { name: "Horários do Funchal", url: "https://www.horariosdofunchal.pt/" },
  "impic": { name: "IMPIC · Instituto dos Mercados Públicos, do Imobiliário e da Construção", url: "https://www.impic.pt/" },
  "ine": { name: "INE · Instituto Nacional de Estatística", url: "https://www.ine.pt/" },
  "ioda": { name: "IODA · Internet Intelligence Lab, Georgia Tech", url: "https://ioda.inetintel.cc.gatech.edu/" },
  "ipma": { name: "IPMA · Instituto Português do Mar e da Atmosfera", url: "https://www.ipma.pt/" },
  "lime": { name: "Lime", url: "https://www.li.me/" },
  "mare": { name: "Maré" },
  "metro-do-porto": { name: "Metro do Porto", url: "https://www.metrodoporto.pt/" },
  "metropolitano-de-lisboa": { name: "Metropolitano de Lisboa", url: "https://www.metrolisboa.pt/" },
  "omie": { name: "OMIE · Iberian electricity market", url: "https://www.omie.es/" },
  "peeringdb": { name: "PeeringDB", url: "https://www.peeringdb.com/" },
  "ren": { name: "REN · Redes Energéticas Nacionais", url: "https://www.ren.pt/" },
  "ribatejana": { name: "Ribatejana" },
  "ripe-ncc": { name: "RIPE NCC", url: "https://www.ripe.net/" },
  "sns-transparencia": { name: "SNS Transparência", url: "https://transparencia.sns.gov.pt/" },
  "stcp": { name: "STCP", url: "https://www.stcp.pt/" },
  "tcb": { name: "Transportes Colectivos do Barreiro", url: "https://www.tcbarreiro.pt/" },
  "tub-braga": { name: "TUB Braga", url: "https://www.tub.pt/" },
  "tubabike": { name: "TubaBike" },
} as const satisfies Record<string, PublisherDescription>;

export type Publisher = keyof typeof PUBLISHERS;

export function isPublisher(value: string | undefined): value is Publisher {
  return value !== undefined && Object.hasOwn(PUBLISHERS, value);
}
