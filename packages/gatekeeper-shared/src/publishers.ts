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
  /**
   * Their mark's file extension, the file itself being
   * `apps/site/public/publishers/<key>.<logo>`, so the key is the whole of the
   * reference. It is their trademark, shown to name them and covered by no
   * dataset's licence. Absent for a publisher whose initials stand in for it.
   */
  logo?: "svg" | "png";
}

export const PUBLISHERS = {
  "agif": { name: "AGIF · Agência para a Gestão Integrada de Fogos Rurais", url: "https://www.agif.pt/" },
  "anepc": { name: "ANEPC · Autoridade Nacional de Emergência e Proteção Civil", url: "https://prociv.gov.pt/", logo: "png" },
  "apa": { name: "APA · Agência Portuguesa do Ambiente", url: "https://apambiente.pt/", logo: "png" },
  "arquivo-pt": { name: "Arquivo.pt", url: "https://arquivo.pt/", logo: "png" },
  "arte": { name: "ARTE · Agência para a Reforma Tecnológica do Estado", logo: "svg" },
  "assembleia-da-republica": { name: "Assembleia da República", url: "https://www.parlamento.pt/", logo: "png" },
  "banco-de-portugal": { name: "Banco de Portugal", url: "https://www.bportugal.pt/", logo: "png" },
  "barraqueiro-oeste": { name: "Barraqueiro Oeste", logo: "png" },
  "bird": { name: "Bird", url: "https://www.bird.co/", logo: "svg" },
  "boa-viagem": { name: "Boa Viagem", logo: "png" },
  "bora": { name: "Bora", logo: "png" },
  "cada": { name: "CADA · Comissão de Acesso aos Documentos Administrativos", url: "https://www.cada.pt/", logo: "png" },
  "carris-metropolitana": { name: "Carris Metropolitana", url: "https://www.carrismetropolitana.pt/", logo: "svg" },
  "cm-agueda": { name: "Câmara Municipal de Águeda", url: "https://www.cm-agueda.pt/", logo: "png" },
  "cm-cadaval": { name: "Município do Cadaval", url: "https://www.cm-cadaval.pt/", logo: "svg" },
  "cm-cascais": { name: "Câmara Municipal de Cascais", url: "https://www.cascais.pt/", logo: "png" },
  "cm-lisboa": { name: "Câmara Municipal de Lisboa", url: "https://www.lisboa.pt/", logo: "svg" },
  "cm-oeiras": { name: "Câmara Municipal de Oeiras", url: "https://www.oeiras.pt/", logo: "png" },
  "cm-porto": { name: "Câmara Municipal do Porto", url: "https://www.cm-porto.pt/", logo: "svg" },
  "cp": { name: "CP", url: "https://www.cp.pt/", logo: "svg" },
  "demarca-design": { name: "DEMARCA Design", logo: "png" },
  "dgeg": { name: "DGEG · Direção-Geral de Energia e Geologia", url: "https://www.dgeg.gov.pt/", logo: "png" },
  "dglab": { name: "DGLAB · Direção-Geral do Livro, dos Arquivos e das Bibliotecas", url: "https://www.dglab.gov.pt/", logo: "png" },
  "dgpj": { name: "DGPJ · Direção-Geral da Política de Justiça", url: "https://dgpj.justica.gov.pt/", logo: "png" },
  "dgs": { name: "DGS · Direção-Geral da Saúde", url: "https://www.dgs.pt/", logo: "png" },
  "dgt": { name: "DGT · Direção-Geral do Território", url: "https://www.dgterritorio.gov.pt/", logo: "png" },
  "e-redes": { name: "E-REDES", url: "https://www.e-redes.pt/", logo: "svg" },
  "effis-jrc": { name: "EFFIS · European Forest Fire Information System, European Commission JRC", url: "https://forest-fire.emergency.copernicus.eu/", logo: "png" },
  "eurostat": { name: "Eurostat", url: "https://ec.europa.eu/eurostat", logo: "svg" },
  "fertagus": { name: "Fertagus", url: "https://www.fertagus.pt/", logo: "png" },
  "horarios-do-funchal": { name: "Horários do Funchal", url: "https://www.horariosdofunchal.pt/", logo: "png" },
  "impic": { name: "IMPIC · Instituto dos Mercados Públicos, do Imobiliário e da Construção", url: "https://www.impic.pt/", logo: "png" },
  "ine": { name: "INE · Instituto Nacional de Estatística", url: "https://www.ine.pt/", logo: "png" },
  "ioda": { name: "IODA · Internet Intelligence Lab, Georgia Tech", url: "https://ioda.inetintel.cc.gatech.edu/", logo: "png" },
  "ipma": { name: "IPMA · Instituto Português do Mar e da Atmosfera", url: "https://www.ipma.pt/", logo: "svg" },
  "mare": { name: "Maré", logo: "png" },
  "metro-do-porto": { name: "Metro do Porto", url: "https://www.metrodoporto.pt/", logo: "svg" },
  "metropolitano-de-lisboa": { name: "Metropolitano de Lisboa", url: "https://www.metrolisboa.pt/", logo: "png" },
  "nasa-firms": { name: "NASA FIRMS · Fire Information for Resource Management System", url: "https://firms.modaps.eosdis.nasa.gov/", logo: "png" },
  "nasa-power": { name: "NASA POWER · Prediction Of Worldwide Energy Resources", url: "https://power.larc.nasa.gov/", logo: "svg" },
  "omie": { name: "OMIE · Iberian electricity market", url: "https://www.omie.es/", logo: "png" },
  "peeringdb": { name: "PeeringDB", url: "https://www.peeringdb.com/", logo: "png" },
  "ren": { name: "REN · Redes Energéticas Nacionais", url: "https://www.ren.pt/", logo: "svg" },
  "ribatejana": { name: "Ribatejana", logo: "png" },
  "ripe-ncc": { name: "RIPE NCC", url: "https://www.ripe.net/", logo: "svg" },
  "sns-transparencia": { name: "SNS Transparência", url: "https://transparencia.sns.gov.pt/", logo: "png" },
  "stcp": { name: "STCP", url: "https://www.stcp.pt/", logo: "svg" },
  "tcb": { name: "Transportes Colectivos do Barreiro", url: "https://www.tcbarreiro.pt/", logo: "svg" },
  "tub-braga": { name: "TUB Braga", url: "https://www.tub.pt/", logo: "svg" },
  "tubabike": { name: "TubaBike", logo: "svg" },
  "usgs": { name: "USGS · U.S. Geological Survey", url: "https://www.usgs.gov/", logo: "svg" },
} as const satisfies Record<string, PublisherDescription>;

export type Publisher = keyof typeof PUBLISHERS;

export function isPublisher(value: string | undefined): value is Publisher {
  return value !== undefined && Object.hasOwn(PUBLISHERS, value);
}
