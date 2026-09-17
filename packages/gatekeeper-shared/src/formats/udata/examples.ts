import type { ExampleFeed } from "../../index";

const MIB = 1024 * 1024;

function annualPolicy(name: string, attribution: string, maxBytes: number): ExampleFeed["policy"] {
  return {
    name,
    version: 1,
    collection: {
      cadenceSeconds: 86_400,
      timeoutSeconds: 45,
      maxBytes,
      historyMode: "changes",
    },
    serving: {
      licence: "CC BY 4.0",
      attribution,
    },
  };
}

/** A policy whose normalized output may exceed the kernel's 16 MiB default cap. */
function withOutputCap(policy: ExampleFeed["policy"], maxOutputBytes: number): ExampleFeed["policy"] {
  return { ...policy, collection: { ...policy.collection, maxOutputBytes } };
}

interface GovernmentDistribution {
  slug: string;
  title: string;
  description: string;
  dataset: string;
  /** Omitted for a publisher that uploads each release as a new resource: the newest in `format` is read. */
  distributionId?: string;
  format: "csv" | "json";
  publisher: string;
  licence: string;
  cadenceSeconds: number;
  maxBytes: number;
  maxOutputBytes: number;
  keyField?: string;
  eventTimeField?: string;
}

function governmentExample(source: GovernmentDistribution): ExampleFeed {
  const config: ExampleFeed["config"] = {
    source: "udata",
    feed: "distribution",
    transformer: "tabular",
    baseUrl: "https://dados.gov.pt",
    dataset: source.dataset,
    format: source.format,
    productSlug: source.slug.replace(/-feed$/, ""),
    productTitle: source.title,
  };
  if (source.distributionId) config.distributionId = source.distributionId;
  if (source.keyField) config.keyField = source.keyField;
  if (source.eventTimeField) config.eventTimeField = source.eventTimeField;
  return {
    slug: source.slug,
    title: source.title,
    description: source.description,
    config,
    policy: {
      name: source.title,
      version: 1,
      collection: { cadenceSeconds: source.cadenceSeconds, timeoutSeconds: 240, maxBytes: source.maxBytes, maxOutputBytes: source.maxOutputBytes, historyMode: "changes" },
      serving: { licence: source.licence, attribution: source.publisher },
    },
    staleAfterSeconds: source.cadenceSeconds * 3,
    publisher: source.publisher,
    topics: ["government"],
  };
}

export const UDATA_EXAMPLES: ExampleFeed[] = [
  {
    slug: "municipal-accessibility-feed",
    title: "Municipal digital accessibility",
    description: "Accessibility measurements for Portuguese municipal websites, published by DEMARCA Design in 2026.",
    config: {
      source: "udata",
      baseUrl: "https://dados.gov.pt",
      dataset: "acessibilidade-digital-nos-municipios-portugueses-1-a-edicao-2026",
      distributionId: "c03ae2c2-9c33-4c6f-9d1a-bb813088d6e6",
      format: "csv",
      productSlug: "municipal-accessibility",
      productTitle: "Municipal digital accessibility",
      keyField: "entidade",
      feed: "distribution",
      transformer: "municipal-accessibility",
    },
    policy: annualPolicy("Municipal accessibility annual snapshot", "DEMARCA Design", 2 * MIB),
    staleAfterSeconds: 30 * 86_400,
    publisher: "DEMARCA Design",
    topics: ["cities"],
  },
  {
    slug: "justice-facilities-feed",
    title: "Portuguese justice facilities",
    description: "Courts and other justice facilities with addresses and coordinates, published by the Directorate-General for Justice Policy.",
    config: {
      source: "udata",
      baseUrl: "https://dados.gov.pt",
      dataset: "justica-no-mapa",
      distributionId: "3d951837-9cae-4474-8b5b-e5934b9a93e8",
      format: "csv",
      productSlug: "justice-facilities",
      productTitle: "Portuguese justice facilities",
      productDescription: "Justice facilities with contact details and map coordinates.",
      keyField: "Nome",
      feed: "distribution",
      transformer: "tabular",
    },
    policy: annualPolicy("Justice facilities annual snapshot", "Direção-Geral da Política de Justiça", 1 * MIB),
    staleAfterSeconds: 30 * 86_400,
    publisher: "DGPJ · Direção-Geral da Política de Justiça",
    topics: ["society"],
  },
  {
    slug: "portuguese-museums-feed",
    title: "Museums and museum centres in Portugal",
    description: "Museum names, locations, websites, and archived web histories compiled by Arquivo.pt in 2026.",
    config: {
      source: "udata",
      baseUrl: "https://dados.gov.pt",
      dataset: "museus-em-portugal-websites-e-historico-preservado-no-arquivo-pt",
      distributionId: "5cdbe7e5-38a6-481b-9542-2637fe7ed3cc",
      format: "csv",
      productSlug: "portuguese-museums",
      productTitle: "Museums and museum centres in Portugal",
      productDescription: "Museums and museum centres with municipality, district, website, and archived history links.",
      keyField: "Nome, entidade, organização... (Títle 1)",
      feed: "distribution",
      transformer: "tabular",
    },
    policy: annualPolicy("Portuguese museums annual snapshot", "Arquivo.pt", 1 * MIB),
    staleAfterSeconds: 30 * 86_400,
    publisher: "Arquivo.pt",
    topics: ["society", "culture"],
  },
  {
    slug: "portuguese-parishes-feed",
    title: "Portuguese parish websites",
    description: "Parish names, municipalities, districts, websites, and archived web histories compiled by Arquivo.pt in 2025.",
    config: {
      source: "udata",
      baseUrl: "https://dados.gov.pt",
      dataset: "freguesias-de-portugal-websites-e-historico-de-versoes-no-arquivo-pt",
      distributionId: "8431fc10-6f5f-4096-80f6-27199f779660",
      format: "csv",
      productSlug: "portuguese-parish-websites",
      productTitle: "Portuguese parish websites",
      productDescription: "Parishes with municipality, district, current website, and Arquivo.pt history link.",
      keyField: "Nome, entidade, organização... (Títle 1)",
      feed: "distribution",
      transformer: "tabular",
    },
    policy: annualPolicy("Portuguese parishes annual snapshot", "Arquivo.pt", 2 * MIB),
    staleAfterSeconds: 30 * 86_400,
    publisher: "Arquivo.pt",
    topics: ["cities"],
  },
  {
    slug: "public-libraries-2024-feed",
    title: "Portuguese public library statistics for 2024",
    description: "Population, collections, visits, loans, activities, staffing, and services reported by public libraries for 2024.",
    config: {
      source: "udata",
      baseUrl: "https://dados.gov.pt",
      dataset: "dados-estatisticos-da-rede-nacional-de-bibliotecas-publicas-2024",
      distributionId: "00f3876f-dfe4-47a1-9f53-e06de3e275a2",
      format: "csv",
      productSlug: "public-library-statistics-2024",
      productTitle: "Portuguese public library statistics for 2024",
      productDescription: "One record per reporting library, with typed population, collection, use, staffing, and service measures.",
      headerRow: "3",
      feed: "distribution",
      transformer: "tabular",
    },
    policy: annualPolicy("Public libraries annual snapshot", "Direção-Geral do Livro, dos Arquivos e das Bibliotecas", 1 * MIB),
    staleAfterSeconds: 30 * 86_400,
    publisher: "DGLAB · Direção-Geral do Livro, dos Arquivos e das Bibliotecas",
    topics: ["society", "culture"],
  },
  {
    slug: "municipal-ev-charging-feed",
    title: "Municipal availability of electric-vehicle charging",
    description: "2023 indicator showing whether each Portuguese municipality provided and located electric-vehicle charging points, published by ARTE.",
    config: {
      source: "udata",
      baseUrl: "https://dados.gov.pt",
      dataset: "enti-indicador-disponibilizacao-e-localizacao-de-postos-de-carregamento-de-veiculos-eletricos",
      distributionId: "309bfd1f-bdb6-442e-9fdd-b9ce41424d40",
      format: "csv",
      productSlug: "municipal-ev-charging-availability",
      productTitle: "Municipal availability of electric-vehicle charging",
      productDescription: "Municipality-level availability of public electric-vehicle charging locations in 2023.",
      eventTimeField: "ano",
      feed: "distribution",
      transformer: "tabular",
    },
    policy: annualPolicy("Municipal EV charging annual snapshot", "Agência para a Reforma Tecnológica do Estado", 1 * MIB),
    staleAfterSeconds: 30 * 86_400,
    publisher: "Agência para a Reforma Tecnológica do Estado",
    topics: ["cities", "energy"],
  },
  {
    slug: "cadaval-municipal-waste-feed",
    title: "Cadaval municipal waste in 2024",
    description: "Monthly tonnes of municipal waste by material and collection route, published by Município do Cadaval for 2024.",
    config: {
      source: "udata",
      baseUrl: "https://dados.gov.pt",
      dataset: "producao-de-residuos-municipio-cadaval",
      distributionId: "33ebfc7e-7951-4170-9d76-d2ad5e8498a6",
      format: "csv",
      productSlug: "cadaval-municipal-waste",
      productTitle: "Cadaval municipal waste in 2024",
      feed: "distribution",
      transformer: "municipal-waste",
    },
    policy: annualPolicy("Cadaval waste annual snapshot", "Município do Cadaval", 256 * 1024),
    staleAfterSeconds: 30 * 86_400,
    publisher: "Município do Cadaval",
    topics: ["cities", "environment"],
  },
  {
    slug: "primary-care-oral-health-referrals-feed",
    title: "Primary-care oral-health referrals",
    description: "Monthly oral-health referrals by sex, age group, and primary-care area, published by the Portuguese health authority.",
    config: {
      source: "udata",
      baseUrl: "https://dados.gov.pt",
      dataset: "evolucao-mensal-das-referenciacoes-emitidas-de-saude-oral-nos-cuidados-de-saude-primarios-socsp-nos-centros-de-saude-agregado-por-aces",
      distributionId: "854aabb7-71ae-42ee-b9d5-4bc70b98d385",
      format: "csv",
      productSlug: "primary-care-oral-health-referrals",
      productTitle: "Primary-care oral-health referrals",
      productDescription: "Monthly issued oral-health referrals by sex, age group, ULS, and primary-care area.",
      keyField: "ID",
      eventTimeField: "Período",
      feed: "distribution",
      transformer: "tabular",
    },
    // About 45,000 rows: the 5.7 MB CSV can normalize to more than the 16 MiB default output cap.
    policy: withOutputCap(annualPolicy("Primary-care oral-health monthly series", "Direção-Geral da Saúde", 8 * MIB), 64 * MIB),
    staleAfterSeconds: 7 * 86_400,
    publisher: "DGS · Direção-Geral da Saúde",
    topics: ["health"],
  },
  governmentExample({
    slug: "cada-opinions-2025-feed",
    title: "CADA administrative-document access opinions for 2025",
    description: "Opinions on access to administrative documents issued in 2025. This is a historical annual publication, not a live legal feed.",
    dataset: "6a886960e18b67254bb6b93b",
    distributionId: "e10e5071-90ea-42cc-aea3-8710222339ba",
    format: "csv",
    keyField: "N.º Parecer",
    eventTimeField: "Data Parecer",
    publisher: "CADA · Comissão de Acesso aos Documentos Administrativos",
    licence: "CC BY 4.0",
    cadenceSeconds: 30 * 86_400,
    maxBytes: 2 * MIB,
    maxOutputBytes: 8 * MIB,
  }),
  governmentExample({
    slug: "recognised-startups-feed",
    title: "Companies recognised with startup status",
    description:
      "The recognised-startup registry snapshot published by ARTE and Startup Portugal, including the source's file date. Publication licence is not specified in the dataset metadata.",
    // ARTE uploads every monthly release as a new resource, so no id is pinned.
    dataset: "660c3c451ee8ad9bd6b60608",
    format: "json",
    keyField: "titularNipc",
    eventTimeField: "fileDate",
    publisher: "ARTE · Agência para a Reforma Tecnológica do Estado",
    licence: "Source terms not stated in the dataset metadata",
    cadenceSeconds: 604_800,
    maxBytes: 2 * MIB,
    maxOutputBytes: 8 * MIB,
  }),
  governmentExample({
    slug: "base-contract-modifications-2026-feed",
    title: "Public-contract modifications published in 2026",
    description:
      "Contract modifications in IMPIC's 2026 publication. The source has no distinct amendment identifier; repeated contract IDs use row-content identities rather than claiming a stable amendment ID.",
    dataset: "668d65dbcb1b953e80198435",
    distributionId: "d6d13c09-418e-443b-bbf4-b9bd77097571",
    format: "json",
    keyField: "idcontrato",
    eventTimeField: "modifDataPublicacao",
    publisher: "IMPIC · Instituto dos Mercados Públicos, do Imobiliário e da Construção",
    licence: "Public domain (other-pd in dados.gov.pt); IMPIC source conditions apply",
    cadenceSeconds: 604_800,
    maxBytes: 8 * MIB,
    maxOutputBytes: 32 * MIB,
  }),
  governmentExample({
    slug: "base-procurement-notices-2026-feed",
    title: "Public-procurement notices published in 2026",
    description:
      "IMPIC's 2026 procurement notices, including contracting authorities, base prices, procedures, deadlines and source links. One current record per notice; not a duplicate of signed contracts.",
    dataset: "66d72fbc58cd7a63dae28712",
    distributionId: "1002987e-8985-492f-9215-e732fffdbc83",
    format: "json",
    keyField: "nAnuncio",
    eventTimeField: "dataPublicacao",
    publisher: "IMPIC · Instituto dos Mercados Públicos, do Imobiliário e da Construção",
    licence: "Public domain (other-pd in dados.gov.pt); IMPIC source conditions apply",
    cadenceSeconds: 604_800,
    maxBytes: 48 * MIB,
    maxOutputBytes: 96 * MIB,
  }),
  governmentExample({
    slug: "base-procurement-entities-feed",
    title: "Public-procurement entities",
    description:
      "Entities in IMPIC's public-procurement registry, with source-published cumulative participation totals. Collected monthly as a large reference snapshot, not a live company-register lookup.",
    dataset: "67d80b2c4750b888116940fb",
    distributionId: "d85c49f0-b6ab-4cb7-afbe-4e103016b9a0",
    format: "json",
    keyField: "nifEntidade",
    publisher: "IMPIC · Instituto dos Mercados Públicos, do Imobiliário e da Construção",
    licence: "Public domain (other-pd in dados.gov.pt); IMPIC source conditions apply",
    cadenceSeconds: 30 * 86_400,
    maxBytes: 80 * MIB,
    maxOutputBytes: 160 * MIB,
  }),
];
