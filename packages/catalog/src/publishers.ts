/**
 * The catalog's publishers: the vocabulary of institutions and operators whose
 * data is served, one key each, so a publisher read through two libraries or
 * found on two portals is one publisher on the site. A feed names one by key;
 * a key outside this list is a mistake the type system and a test catch.
 *
 * A publisher is where the data comes from: the body that stands behind it.
 * A site that only carries what others put on it is a shelf and not one of
 * these — dados.gov.pt holds ten publishers and is none of them — while a body
 * that curates what it serves is, even where it did not draw every line
 * itself, as DGT is of the municipal plans it redraws into a national
 * classification.
 */
export interface PublisherDescription {
  /** The name as a heading shows it: an acronym and what it stands for, or the operator's name. */
  name: string;
  /** The publisher's own site, not the portal the data was read from. */
  url?: string;
  /**
   * Their mark's file extension, the file itself being
   * `packages/catalog/publishers/<key>.<logo>`, so the key is the whole of the
   * reference. It is their trademark, shown to name them and covered by no
   * dataset's licence. Absent for a publisher whose initials stand in for it.
   */
  logo?: "svg" | "png";
  /**
   * Whether we may republish what they publish. Absent means we may. `false`
   * holds every feed of theirs out of what the Gatekeeper installs, so nothing
   * of theirs is polled or served, while the code that reads them stays and a
   * comment here says what we are waiting for. Lifting a hold is one word.
   */
  enabled?: boolean;
}

export const PUBLISHERS = {
  "agif": { name: "AGIF · Agência para a Gestão Integrada de Fogos Rurais", url: "https://www.agif.pt/", logo: "svg" },
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
  "cm-mafra": { name: "Município de Mafra", url: "https://www.cm-mafra.pt/", logo: "svg" },
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
  // Held: Georgia Tech states no terms for IODA — every response reserves rights rather than granting them — and
  // signals it blends (Merit's telescope, Google's Transparency Report, RIPE RIS) carry their own bars on
  // redistribution. Waiting on ioda-info@cc.gatech.edu. https://api.ioda.inetintel.cc.gatech.edu/v2/datasources/
  "ioda": { name: "IODA · Internet Intelligence Lab, Georgia Tech", url: "https://ioda.inetintel.cc.gatech.edu/", logo: "png", enabled: false },
  "ipma": { name: "IPMA · Instituto Português do Mar e da Atmosfera", url: "https://www.ipma.pt/", logo: "svg" },
  // LNEG draws its own mark white on transparent, which disappears on the tile
  // the site draws it on, and the only other mark on its services is pygeoapi's,
  // which is not theirs to stand for them. Their initials stand in instead.
  "lneg": { name: "LNEG · Laboratório Nacional de Energia e Geologia", url: "https://www.lneg.pt/", logo: "png" },
  "mare": { name: "Maré", logo: "png" },
  "metro-do-porto": { name: "Metro do Porto", url: "https://www.metrodoporto.pt/", logo: "svg" },
  "metropolitano-de-lisboa": { name: "Metropolitano de Lisboa", url: "https://www.metrolisboa.pt/", logo: "png" },
  "nasa-firms": { name: "NASA FIRMS · Fire Information for Resource Management System", url: "https://firms.modaps.eosdis.nasa.gov/", logo: "png" },
  "nasa-power": { name: "NASA POWER · Prediction Of Worldwide Energy Resources", url: "https://power.larc.nasa.gov/", logo: "svg" },
  "omie": { name: "OMIE · Iberian electricity market", url: "https://www.omie.es/", logo: "png" },
  // Held: PeeringDB's acceptable-use policy requires permission for reproduction and bulk sharing outside its
  // approved operational uses. Asked, awaiting an answer. https://www.peeringdb.com/aup
  "peeringdb": { name: "PeeringDB", url: "https://www.peeringdb.com/", logo: "png", enabled: false },
  "porto-digital": { name: "Porto Digital", url: "https://www.portodigital.pt/" },
  "ren": { name: "REN · Redes Energéticas Nacionais", url: "https://www.ren.pt/", logo: "svg" },
  "ribatejana": { name: "Ribatejana", logo: "png" },
  // Held: the RIPEstat and RIPE Atlas service terms (Articles 3.3 and 3.5) bar re-packaging and redistributing
  // their data, and Atlas adds that third parties need prior written authorisation. Keyless access is not
  // permission. Asked, awaiting an answer. https://www.ripe.net/about-us/legal/terms-of-service/
  "ripe-ncc": { name: "RIPE NCC", url: "https://www.ripe.net/", logo: "svg", enabled: false },
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

/** Whether a publisher's feeds may be installed: every publisher but the ones held for permission. */
export function publisherEnabled(key: string): boolean {
  const known = isPublisher(key) ? PUBLISHERS[key] : undefined;
  return known === undefined || !("enabled" in known) || known.enabled;
}
