import type { CollectionPolicyDefinition, ExampleFeed, ServingPolicyDefinition } from "../../index";

const MEBIBYTE = 1024 * 1024;
const DGT_HOST = "ogcapi.dgterritorio.gov.pt";

const WEEK = 604_800;

/** The CAOP is republished as a dated edition, not continuously; weekly is frequent enough to catch a correction. */
const DGT_SERVING: ServingPolicyDefinition = {
  // The service does state its terms, but only in its HTML representation:
  // `https://ogcapi.dgterritorio.gov.pt/?f=html` carries "Terms of service —
  // https://creativecommons.org/licenses/by/4.0/", which pygeoapi leaves out
  // of the `?f=json` landing page this library actually reads. DGT's own site
  // and its dados.gov.pt records agree on CC BY 4.0.
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Carta Administrativa Oficial de Portugal (CAOP) 2025",
};

/** What DGT is credited as, per dataset; the licence is CC BY 4.0 across the service. */
function dgtServing(dataset: string): ServingPolicyDefinition {
  return { licence: "cc-by-4.0", attribution: `Direção-Geral do Território — ${dataset}` };
}

/** Attribute tables: a few hundred kilobytes at most, every property on every feature. */
function attributePolicy(name: string, serving: ServingPolicyDefinition, maxBytes: number): ExampleFeed["policy"] {
  return {
    name,
    version: 3,
    collection: {
      cadenceSeconds: WEEK,
      timeoutSeconds: 120,
      maxBytes,
      historyMode: "changes",
    } satisfies CollectionPolicyDefinition,
    serving,
  };
}

/**
 * One layer of the SRUP — the public-utility easements and restrictions in
 * force on the mainland. Every layer carries the same register columns, so one
 * description here is the whole of what differs between them.
 */
interface SrupLayer {
  slug: string;
  collection: string;
  title: string;
  description: string;
  /** Read once from the service, and what the description promises. */
  features: number;
  /**
   * Outlines are collected only where they are small enough to be worth it: a
   * protected area averages half a megabyte of coordinates and a geodetic mark's
   * protection zone twelve kilobytes, so those are read as attributes alone.
   */
  geometry?: "include";
  /** The columns worth publishing, where the layer holds one value for the rest of them. */
  properties?: string;
  topics: NonNullable<ExampleFeed["topics"]>;
  /** Measured: the whole layer as this feed reads it, with room to grow. */
  maxBytes: number;
}

/*
 * The SRUP layers small enough to publish whole. Four are not here: the fire
 * hazard chart (1,787,684 features), the SGIFR areas and lines (490,437 and
 * 239,863) and the cadastral parcels (1,814,264) are national coverages rather
 * than registers, and no page budget makes them a table.
 *
 * `serv_data` is the day the act took effect and `serv_hiperligacao` the act
 * itself, so each row is dated by the source's own clock and carries its proof.
 *
 * What these rows are keyed by is the service's own `fid`, which its published
 * schema marks as the identifier and which runs 1..N in load order. It is the
 * only identifier the layers carry — no row holds a reference of its own, and
 * two entries of the same easement under the same act are told apart by nothing
 * else — so it is what a feed can use. The cost is that a reload which renumbers
 * a layer reads as every row being retracted and a new one created. That is
 * visible rather than silent: a whole-layer churn on a register that gains a
 * handful of rows a year is the shape of a renumbering, not of a change in the
 * law. Nothing here can prevent it; the alternative, a key built from the
 * columns, would collide on the very rows that need telling apart.
 */
const SRUP_LAYERS: SrupLayer[] = [
  {
    slug: "dgt-srup-reserva-ecologica-areas-feed",
    collection: "srup_ren_areal",
    title: "National Ecological Reserve delimitations in force",
    description:
      "Every municipal delimitation of the Reserva Ecológica Nacional in force on the Portuguese mainland — 399 of them, each an ordinance or notice with the municipality it covers, the area it protects in hectares, whether it is the reserve itself or an exclusion from it, and a link to the act in the Diário da República. Attributes only: the outlines are too large to carry.",
    features: 399,
    topics: ["environment", "government"],
    maxBytes: 2 * MEBIBYTE,
  },
  {
    slug: "dgt-srup-reserva-ecologica-linhas-feed",
    collection: "srup_ren_linear",
    title: "National Ecological Reserve watercourse delimitations",
    description:
      "The 138 linear delimitations of the Reserva Ecológica Nacional — watercourses and the ten-metre beds either side of them — with the act that set each one, its date and the municipality it covers. Attributes only.",
    features: 138,
    topics: ["environment", "government"],
    maxBytes: MEBIBYTE,
  },
  {
    slug: "dgt-srup-reserva-agricola-feed",
    collection: "srup_ran",
    title: "National Agricultural Reserve delimitations in force",
    description:
      "The Reserva Agrícola Nacional as delimited for each of 269 mainland municipalities, with the ordinance or notice that set it, the issue of the Diário da República it appeared in, the date it took effect and a link to the act. Attributes only.",
    features: 269,
    properties: "designacao,serv_dr,serv_data,serv_hiperligacao,serv_lei,municipio",
    topics: ["environment", "government"],
    maxBytes: 2 * MEBIBYTE,
  },
  {
    slug: "dgt-srup-areas-protegidas-feed",
    collection: "srup_areas_protegidas",
    title: "Protected areas as a public-utility restriction",
    description:
      "The 71 classified protected areas of mainland Portugal — national, natural and regional parks, nature reserves, natural monuments and protected landscapes — each with the decree that created it, its date, the municipalities it spans and a link to the act. Attributes only: one protected area averages half a megabyte of outline.",
    features: 71,
    topics: ["environment", "government"],
    maxBytes: MEBIBYTE,
  },
  {
    slug: "dgt-srup-rede-natura-zec-feed",
    collection: "srup_zec",
    title: "Natura 2000 Special Areas of Conservation",
    description:
      "The 65 Zonas Especiais de Conservação of the Natura 2000 network on the Portuguese mainland, with the phase of the national site list each belongs to, the decree that designated it, its date and the municipalities it covers. Attributes only.",
    features: 65,
    topics: ["environment", "government"],
    maxBytes: MEBIBYTE,
  },
  {
    slug: "dgt-srup-rede-natura-zpe-feed",
    collection: "srup_zpe",
    title: "Natura 2000 Special Protection Areas",
    description:
      "The 44 Zonas de Proteção Especial for wild birds on the Portuguese mainland, with the decree that designated each one, its date, the municipalities it covers and a link to the act. Attributes only.",
    features: 44,
    properties: "designacao,serv_dr,serv_data,serv_hiperligacao,serv_lei,municipio,dtccs",
    topics: ["environment", "government"],
    maxBytes: MEBIBYTE,
  },
  {
    slug: "dgt-srup-arvores-interesse-publico-pontos-feed",
    collection: "srup_arvores_point",
    title: "Trees of public interest",
    description:
      "The 551 individual trees and groves classified as being of public interest in mainland Portugal, where each one stands, its species, whether it is a single tree or a group, and the notice that classified it. Lisbon holds 84 of them and Marinha Grande 34; the oldest classification here dates from 1947.",
    features: 551,
    geometry: "include",
    topics: ["environment", "culture"],
    maxBytes: 2 * MEBIBYTE,
  },
  {
    slug: "dgt-srup-arvores-interesse-publico-areas-feed",
    collection: "srup_arvores_areal",
    title: "Groves of public interest",
    description:
      "The 89 wooded areas classified as being of public interest in mainland Portugal, with the species, the act that classified each one and the municipality it stands in. Attributes only.",
    features: 89,
    topics: ["environment", "culture"],
    maxBytes: MEBIBYTE,
  },
  {
    slug: "dgt-srup-marcos-geodesicos-feed",
    collection: "srup_marcos_geod",
    title: "Geodetic marks and their protection zones",
    description:
      "The 7,968 geodetic marks of mainland Portugal whose surroundings are protected by law, with the name each one is known by, the network it belongs to and the municipality it stands in. Odemira holds 193 of them. Attributes only: what is stored is the protection zone around each mark, not the mark itself. Every one of these is protected by the same 1982 decree, which the feed states once rather than on every row. This is the easement side of the register; the survey side, with each mark's order and height, is published separately from the geodetic network itself.",
    features: 7968,
    properties: "designacao,tipologia,municipio,dtccs",
    topics: ["government", "society"],
    maxBytes: 4 * MEBIBYTE,
  },
  {
    slug: "dgt-srup-aeronautica-feed",
    collection: "srup_aeronautica",
    title: "Airport and aerodrome easements",
    description:
      "The 36 airports and aerodromes of mainland Portugal whose surroundings carry an aeronautical easement, with the decree that established each one, its date, the municipalities it reaches and a link to the act. Attributes only.",
    features: 36,
    topics: ["mobility", "government"],
    maxBytes: MEBIBYTE,
  },
  {
    slug: "dgt-srup-albufeiras-feed",
    collection: "srup_albufeiras",
    title: "Classified public water reservoirs",
    description:
      "The 192 classified reservoirs of mainland Portugal, sorted into protected, conditioned and freely used, with the ordinance that classified each one and the municipalities around it. Attributes only.",
    features: 192,
    topics: ["environment", "energy"],
    maxBytes: MEBIBYTE,
  },
  {
    slug: "dgt-srup-captacoes-aguas-subterraneas-feed",
    collection: "srup_aquiferos",
    title: "Protection zones around public groundwater abstraction",
    description:
      "The 949 protection perimeters around groundwater abstracted for public supply in mainland Portugal, with the ordinance that set each one, its date and the municipality it lies in. Pampilhosa da Serra and Góis hold 155 between them. Attributes only: one perimeter averages nine kilobytes of outline.",
    features: 949,
    topics: ["environment", "health"],
    maxBytes: 2 * MEBIBYTE,
  },
  {
    slug: "dgt-srup-defesa-nacional-feed",
    collection: "srup_defesa_militar",
    title: "National defence easements",
    description:
      "The 152 military installations of mainland Portugal carrying a defence easement — barracks, forts and batteries — with the act that established each one, its date and the municipality it stands in. Lisbon holds 20. Attributes only.",
    features: 152,
    topics: ["government"],
    maxBytes: MEBIBYTE,
  },
  {
    slug: "dgt-srup-defesa-nacional-zonas-feed",
    collection: "srup_defesa_militar_zonas",
    title: "National defence protection zones",
    description:
      "The 149 protection zones around military installations in mainland Portugal, with the act that established each one, its date and the municipality it covers. Attributes only.",
    features: 149,
    topics: ["government"],
    maxBytes: MEBIBYTE,
  },
  {
    slug: "dgt-srup-rede-rodoviaria-feed",
    collection: "srup_rede_viaria",
    title: "National road network easements",
    description:
      "The 3,160 stretches of the national road network carrying an easement, each named for the road it belongs to — the A1, the EN2, a link ramp — and sorted into motorway, national road, regional road and municipal road, with the municipality it crosses. Porto holds 121 stretches. Attributes only.",
    features: 3160,
    topics: ["mobility", "government"],
    maxBytes: 4 * MEBIBYTE,
  },
  {
    slug: "dgt-srup-rede-ferroviaria-feed",
    collection: "srup_rede_ferroviaria",
    title: "Railway easements",
    description:
      "The 502 stretches of railway in mainland Portugal carrying an easement, with the act that established it, its date and the municipality it crosses. Attributes only.",
    features: 502,
    topics: ["mobility", "government"],
    maxBytes: 2 * MEBIBYTE,
  },
  {
    slug: "dgt-srup-estacoes-ferroviarias-feed",
    collection: "srup_rede_ferroviaria_estacoes",
    title: "Railway stations and halts",
    description:
      "The 860 railway stations and halts of mainland Portugal held in the easement register, each named and sorted into station, halt, or no longer worked — 298 of them are out of service. Lisbon holds 21. Attributes only. All 860 rest on the same 2003 decree, which the feed states once rather than on every row.",
    features: 860,
    properties: "designacao,tipologia,municipio,dtccs",
    topics: ["mobility", "government"],
    maxBytes: 2 * MEBIBYTE,
  },
  {
    slug: "dgt-srup-rede-eletrica-feed",
    collection: "srup_rede_eletrica",
    title: "Electricity grid easements",
    description:
      "The 2,456 stretches of the national electricity grid carrying an easement in mainland Portugal, sorted by voltage, with the decree behind each one and the municipality it crosses. Attributes only.",
    features: 2456,
    topics: ["energy", "government"],
    maxBytes: 4 * MEBIBYTE,
  },
  {
    slug: "dgt-sgifr-pontos-feed",
    collection: "sgifr_pontos",
    title: "Rural fire management points",
    description:
      "The 7,841 points held in the sub-regional rural fire management programmes of mainland Portugal: 7,550 water points for firefighting, 172 lookout and detection posts, and the rest strategic fuel-break mosaics. Each carries the intermunicipal body that answers for it, the programme it belongs to and the notice that approved that programme.",
    features: 7841,
    geometry: "include",
    topics: ["environment", "government"],
    maxBytes: 12 * MEBIBYTE,
  },
];

/**
 * A register layer: read whole every week, with room for the pages the count
 * needs. The service answers each of these in well under a second and publishes
 * no validator, so the cost of a run is one small walk, not a re-download of
 * anything large.
 */
function srupFeed(layer: SrupLayer): ExampleFeed {
  const geometry = layer.geometry ?? "skip";
  const config: ExampleFeed["config"] = {
    source: "ogc",
    host: DGT_HOST,
    collection: layer.collection,
    geometry,
    pageSize: "500",
    maxPages: String(Math.max(4, Math.ceil(layer.features / 500) + 2)),
  };
  if (layer.properties) config.properties = layer.properties;
  return {
    slug: layer.slug,
    title: layer.title,
    description: layer.description,
    config,
    policy: {
      name: "SRUP weekly register",
      version: 1,
      collection: {
        // A restriction changes when an act is published, which happens a
        // handful of times a year across the whole register. Weekly catches one
        // within days and costs one short walk of a few hundred kilobytes.
        cadenceSeconds: WEEK,
        timeoutSeconds: 180,
        maxBytes: layer.maxBytes,
        historyMode: "changes",
      } satisfies CollectionPolicyDefinition,
      serving: dgtServing("Servidões e Restrições de Utilidade Pública"),
    },
    // Two weeks: an act published the day after a run should not make the feed
    // look stale before the next one has had a chance to catch it.
    staleAfterSeconds: 2 * WEEK,
    publisher: "dgt",
    topics: layer.topics,
  };
}

/*
 * The Carta do Regime de Uso do Solo is one dataset — every parcel of mainland
 * Portugal, classified the same way — so it is one feed and one product.
 *
 * It is also 229,768 parcels and 191 MB, read in 47 pages of five thousand.
 * That is a third of the million rows the kernel's own scale gate covers, and
 * well inside the limits a policy may declare, so nothing about its size calls
 * for cutting it into municipalities. What does have to be handled is the
 * service: walking it end to end, about one page in fifty comes back 502, and
 * every page must arrive for the collection to be whole. The reader tries a
 * failed page again rather than the dataset being shaped around a flaky
 * gateway.
 *
 * Every column the layer holds is asked for, `autor` and `objectid` included.
 * Walking the whole layer they are constant and redundant — `autor` is DGT on
 * all 229,768 parcels and `objectid` equals `fid` on every one — but they are
 * what the charter records about who drew a parcel and what the source calls
 * it, and a reader matching this against DGT's own systems needs them. `Autor`
 * is also half of the pair that says whose data this is: DGT drew it, `fonte`
 * says which municipality's plan it came from.
 */
const CRUS_COLUMNS =
  "objectid,dtcc,municipio,designacao_no_plano,classe_2021,categoria_2021,escala_origem,fonte,area_ha,autor,data_pub_origem,registo_ou_deposito,situacao_pdm,codigo";

/*
 * The same charter, with the outlines this time.
 *
 * Every parcel's boundary comes to about 3.4 GB and half an hour of streaming,
 * from a service that loses a connection every few minutes — one sitting will
 * not do it. So it is read a few municipalities a run, each one twelve
 * megabytes and a few seconds, and the runs pile up into a single dataset: the
 * kernel merges a partial snapshot into what is already served rather than
 * replacing it.
 *
 * Which municipalities exist is read from the administrative charter's own
 * codes rather than written down here, and `dtcc` on a parcel is that same
 * code — checked against Lisboa, 1106 either side. Sharding on the code rather
 * than the name also steps around the layer spelling Constância with an Ã.
 *
 * A partial snapshot cannot say a parcel is gone. What can is `dgt-crus-feed`,
 * which reads every row of the same collection without outlines, finishes in
 * one sitting, and is authoritative when it does: a shape whose parcel is no
 * longer in that table is a shape nothing references.
 */
const CRUS_BOUNDARIES: ExampleFeed = {
  slug: "dgt-crus-shapes-feed",
  title: "Mainland Portugal land-use regime: parcel boundaries (CRUS)",
  description:
    "The boundary of every parcel in the Carta do Regime de Uso do Solo, with the class and category of soil its municipal plan puts it in. Read a few municipalities at a time and built up into one national layer, because the whole of it is 3.4 GB of coordinates. Each boundary carries the same parcel identifier as the land-use table, so the two join on it: this feed says where a parcel is, and that one says whether it is still in force.",
  config: {
    source: "ogc",
    host: DGT_HOST,
    collection: "crus",
    geometry: "include",
    properties: CRUS_COLUMNS,
    shardField: "dtcc",
    shardSource: "municipios",
    shardSourceField: "dtmn",
    // Twenty-four municipalities a run: about 280 MB and a few minutes, and the
    // whole country in a quarter of weekly runs.
    shardsPerRun: "24",
    pageSize: "500",
    maxPages: "60",
  },
  policy: {
    name: "CRUS parcel boundaries",
    version: 1,
    collection: {
      // Weekly while the country is being covered; once it is, a month between
      // reads is what the charter itself changes at.
      cadenceSeconds: WEEK,
      timeoutSeconds: 600,
      maxBytes: 512 * MEBIBYTE,
      maxOutputBytes: 512 * MEBIBYTE,
      // The largest parcel boundary measured over 3,600 sampled is 749 KiB.
      maxRecordBytes: 1024 * 1024,
      maxRecords: 400_000,
      historyMode: "changes",
    } satisfies CollectionPolicyDefinition,
    serving: dgtServing("Carta do Regime de Uso do Solo"),
  },
  // A run covers a slice, so the feed is only stale when a whole rotation is missed.
  staleAfterSeconds: 4 * WEEK,
  publisher: "dgt",
  topics: ["cities", "government"],
};

const CRUS_NATIONAL: ExampleFeed = {
  slug: "dgt-crus-feed",
  title: "Mainland Portugal land-use regime (CRUS)",
  description:
    "Every parcel of mainland Portugal in the Carta do Regime de Uso do Solo — 229,768 of them, across all 278 municipalities — with the class and category of soil its municipal plan puts it in, the designation the plan uses, its area in hectares, the scale it was drawn at, where DGT took it from, whether the plan behind it is still in force, and that plan's deposit reference and publication date. Attributes only, without parcel outlines: Lisbon's 861 parcels alone carry nineteen megabytes of them.",
  config: {
    source: "ogc",
    host: DGT_HOST,
    collection: "crus",
    geometry: "skip",
    properties: CRUS_COLUMNS,
    pageSize: "5000",
    maxPages: "60",
  },
  policy: {
    name: "CRUS national register",
    version: 1,
    collection: {
      // A municipal plan is revised over years, and the acts that revise one
      // are already read weekly from the register that publishes them. Monthly
      // is what the redrawn charter itself changes at, and it asks this service
      // for one walk a month rather than 278.
      cadenceSeconds: 2_592_000,
      // Measured at 109 seconds for the walk, before any page is retried.
      timeoutSeconds: 600,
      maxBytes: 256 * MEBIBYTE,
      maxOutputBytes: 192 * MEBIBYTE,
      // The largest parcel row measured is 723 bytes.
      maxRecordBytes: 16 * 1024,
      maxRecords: 400_000,
      historyMode: "changes",
    } satisfies CollectionPolicyDefinition,
    serving: dgtServing("Carta do Regime de Uso do Solo"),
  },
  staleAfterSeconds: 2 * 2_592_000,
  publisher: "dgt",
  topics: ["cities", "government"],
};

/*
 * LNEG runs its own pygeoapi at `ogcapi.lneg.pt`, whose landing page states
 * CC BY 4.0 the same way DGT's does. These five are its collections that read
 * as tables rather than as INSPIRE plumbing: the harmonised 1:200,000 layers
 * are the same geology under column names the service truncates to
 * `..._representativeli_2`, which no reader can use.
 *
 * All five carry their geometry: the three point layers cost under half a
 * kilobyte a feature, and the two that do not are small enough in count to
 * make up for it.
 */
interface LnegLayer {
  slug: string;
  collection: string;
  title: string;
  description: string;
  features: number;
  topics: NonNullable<ExampleFeed["topics"]>;
  maxBytes: number;
}

const LNEG_LAYERS: LnegLayer[] = [
  {
    slug: "lneg-ocorrencias-minerais-feed",
    collection: "siorminp-mineral-occurrences",
    title: "Mineral occurrences in Portugal",
    description:
      "The 5,483 mineral occurrences in LNEG's national inventory: where each one is, what it holds, its geological description, its size, and how it rates for economic and development potential.",
    features: 5483,
    topics: ["economy", "environment"],
    maxBytes: 12 * MEBIBYTE,
  },
  {
    slug: "lneg-sondagens-feed",
    collection: "sondabase-sondagem",
    title: "Boreholes in the national database",
    description: "The 3,497 boreholes in LNEG's SondaBase: where each was drilled, its name, its length, the elevation it started from and the direction it took.",
    features: 3497,
    topics: ["environment", "economy"],
    maxBytes: 4 * MEBIBYTE,
  },
  {
    slug: "lneg-pontos-de-agua-feed",
    collection: "recursoshidro-pontos-de-gua",
    title: "Groundwater points",
    description:
      "The 5,399 water points in LNEG's groundwater inventory: where each is, the district it lies in, its elevation, what kind of point it is, what it is used for and what it was surveyed for.",
    features: 5399,
    topics: ["environment"],
    maxBytes: 4 * MEBIBYTE,
  },
  {
    slug: "lneg-sistemas-aquiferos-feed",
    collection: "recursoshidro-sistemas-aqu-feros",
    title: "Aquifer systems",
    description:
      "The 63 aquifer systems of Portugal as LNEG delimits them, with their outlines, the national code each carries, the geological age of the rock that holds the water and the hydrogeological unit each belongs to.",
    features: 63,
    topics: ["environment"],
    maxBytes: 4 * MEBIBYTE,
  },
  {
    slug: "lneg-falhas-geologicas-feed",
    collection: "cgp1m-ge-geologicfault",
    title: "Geological faults at 1:1,000,000",
    description: "The 297 faults of the harmonised 1:1,000,000 geological map of Portugal, each with the kind of fault it is and the vocabulary term LNEG classifies it under.",
    features: 297,
    topics: ["environment"],
    maxBytes: 4 * MEBIBYTE,
  },
];

function lnegFeed(layer: LnegLayer): ExampleFeed {
  return {
    slug: layer.slug,
    title: layer.title,
    description: layer.description,
    config: {
      source: "ogc",
      host: "ogcapi.lneg.pt",
      collection: layer.collection,
      geometry: "include",
      pageSize: "500",
      maxPages: String(Math.max(4, Math.ceil(layer.features / 500) + 2)),
    },
    policy: {
      name: "LNEG monthly reference layer",
      version: 1,
      collection: {
        // Geology is not news. Monthly is often enough to catch an inventory
        // being extended, and asks the service for one walk every four weeks.
        cadenceSeconds: 2_592_000,
        timeoutSeconds: 300,
        maxBytes: layer.maxBytes,
        historyMode: "changes",
      } satisfies CollectionPolicyDefinition,
      serving: {
        // The service's HTML landing page states CC BY 4.0, exactly as DGT's does.
        licence: "cc-by-4.0",
        attribution: "Laboratório Nacional de Energia e Geologia",
      },
    },
    staleAfterSeconds: 2 * 2_592_000,
    publisher: "lneg",
    topics: layer.topics,
  };
}

export const OGC_EXAMPLES: ExampleFeed[] = [
  /*
   * DGT publishes the CAOP for Portugal Continental only: 18 districts, 278
   * municipalities and 3,049 parishes, with the Azores and Madeira absent from
   * these collections. Every title and description says so.
   *
   * They are collected without geometry. One district outline reaches 3.6 MB
   * and two municipal outlines pass 1 MB, which is the largest record the
   * platform stores; the whole municipal layer is 49 MB of coordinates that
   * would be re-read and re-compared on every collection. `skipGeometry` is a
   * documented OGC API Features parameter, the product page says the feed asks
   * for attributes only, and every feature is still published: the scope is
   * complete, only the shape is left at the source.
   */
  {
    slug: "dgt-caop-distritos-feed",
    title: "Mainland Portugal district reference table (CAOP 2025)",
    description:
      "The 18 districts of mainland Portugal in the official administrative charter: code, name, NUTS 1 region, area, perimeter, and how many municipalities and parishes each holds. Attributes only, without boundary outlines. The Azores and Madeira are not part of this collection.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "distritos",
      geometry: "skip",
      pageSize: "1000",
      maxPages: "5",
    },
    policy: attributePolicy("OGC weekly attribute table", DGT_SERVING, 4 * MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "dgt",
    topics: ["society"],
  },
  {
    slug: "dgt-caop-municipios-feed",
    title: "Mainland Portugal municipality reference table (CAOP 2025)",
    description:
      "The 278 municipalities of mainland Portugal in the official administrative charter: DTMN code, name, district, the three NUTS levels, area, perimeter, and parish count. Attributes only, without boundary outlines. The Azores and Madeira are not part of this collection.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "municipios",
      geometry: "skip",
      pageSize: "1000",
      maxPages: "5",
    },
    policy: attributePolicy("OGC weekly attribute table", DGT_SERVING, 4 * MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "dgt",
    topics: ["society"],
  },
  {
    slug: "dgt-caop-freguesias-feed",
    title: "Mainland Portugal parish reference table (CAOP 2025)",
    description:
      "The 3,049 civil parishes of mainland Portugal in the official administrative charter: DTMNFR code, name, municipality, district, the three NUTS levels, area and perimeter. Attributes only, without boundary outlines. The Azores and Madeira are not part of this collection.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "freguesias",
      geometry: "skip",
      pageSize: "1000",
      maxPages: "5",
    },
    policy: attributePolicy("OGC weekly attribute table", DGT_SERVING, 8 * MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "dgt",
    topics: ["society"],
  },
  /*
   * The `admin` collection is deliberately not read. It holds the same 3,049
   * parishes split into their 3,392 disjoint parts, which is a difference in
   * outline — and these feeds carry no outlines. Without them it would republish
   * every parish's code, name, municipality and NUTS levels a second time.
   */
  {
    slug: "dgt-caop-nuts2-feed",
    title: "Mainland Portugal NUTS II reference table (CAOP 2025)",
    description:
      "The seven NUTS II regions the charter covers, with the code, the area in hectares, the perimeter and how many municipalities and parishes each holds. The Azores and Madeira appear here as regions of the statistical hierarchy, though their areas are not part of this collection.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "nuts2",
      geometry: "skip",
      pageSize: "100",
      maxPages: "4",
    },
    policy: attributePolicy("OGC weekly attribute table", DGT_SERVING, MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "dgt",
    topics: ["society"],
  },
  {
    slug: "dgt-caop-nuts3-feed",
    title: "Mainland Portugal NUTS III reference table (CAOP 2025)",
    description:
      "The 24 NUTS III sub-regions of mainland Portugal, with the code, the NUTS II region and NUTS I level above them, the area in hectares, the perimeter, and how many municipalities and parishes each holds.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "nuts3",
      geometry: "skip",
      pageSize: "100",
      maxPages: "4",
    },
    policy: attributePolicy("OGC weekly attribute table", DGT_SERVING, MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "dgt",
    topics: ["society"],
  },
  {
    slug: "dgt-caop-trocos-feed",
    title: "Mainland Portugal administrative boundary segments (CAOP 2025)",
    description:
      "The 9,899 segments the administrative boundaries of mainland Portugal are drawn from: which area lies either side of each one, whether it runs on land or along the coast, the order of boundary it carries, whether it is settled or still undefined, and how long it is. Attributes only, without the lines themselves.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "trocos",
      geometry: "skip",
      pageSize: "1000",
      maxPages: "14",
    },
    policy: attributePolicy("OGC weekly attribute table", DGT_SERVING, 8 * MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "dgt",
    topics: ["society"],
  },

  ...SRUP_LAYERS.map(srupFeed),
  CRUS_NATIONAL,
  CRUS_BOUNDARIES,
  ...LNEG_LAYERS.map(lnegFeed),

  /*
   * The eight Azores collections that lived here were removed in September 2026.
   * ambiente.azores.gov.pt sits behind a Cloudflare managed challenge that answers
   * our Workers with 403 and `cf-mitigated: challenge` on every request, whatever
   * user agent they send, so not one of those feeds ever collected. A publication
   * hold is per library and would have taken the DGT feeds down with them, so the
   * examples go instead and the Registry retires the eight feeds. Restoring them
   * needs the regional government to let our traffic through — a WAF skip rule for
   * the IDEA API paths, or a documented token — after which these entries come back
   * against host `ambiente.azores.gov.pt`, base path `idea-api`, collections Farois,
   * Operadores_GestaoResiduos, RedeMonitorizacao_QualidadeAr, Rede_Hidrometeorologica,
   * Lagoas, Zonas_EspeciaisConservacao, Geositios and Parques_NaturaisIlha, under
   * CC BY 4.0 with the same slugs, which their history depends on:
   * azores-farois-feed, azores-operadores-residuos-feed, azores-estacoes-qualidade-ar-feed,
   * azores-rede-hidrometeorologica-feed, azores-lagoas-feed,
   * azores-zonas-especiais-conservacao-feed, azores-geossitios-feed and
   * azores-parques-naturais-feed.
   */
];
