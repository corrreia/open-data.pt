import type { CollectionPolicyDefinition, ExampleFeed, ServingPolicyDefinition } from "../../index";

const MEBIBYTE = 1024 * 1024;
const DGT_HOST = "ogcapi.dgterritorio.gov.pt";

const WEEK = 604_800;
const MONTH = 2_592_000;

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

/**
 * What one walk of a layer was measured to cost, in mebibytes and kibibytes.
 *
 * These are read numbers, not estimates. The service matters here: pygeoapi
 * pretty-prints its JSON and sends it uncompressed — asking for gzip returns
 * none — so a layer's outlines cost the same over the wire as they do on disk,
 * about four times what the same features would take compactly. `source` is
 * therefore both what is downloaded and what the kernel's byte budget counts.
 */
interface LayerSize {
  /** Mebibytes of JSON the whole walk reads from the service. */
  source: number;
  /** Mebibytes of normalized rows the walk produces. */
  output: number;
  /** Kibibytes of the largest single row, which sets the per-record ceiling. */
  largestRow: number;
}

/** Measured at about five mebibytes a second across every layer read, which is what the deadlines below assume. */
const SOURCE_MIB_PER_SECOND = 5;

/**
 * Budgets sized from a reading of the layer rather than guessed at.
 *
 * Each allowance is the measurement plus a third, which lets a register gain
 * rows between one reading and the next without letting a runaway response
 * through. The deadline is the download at the speed the service was measured
 * to send, doubled, and never under two minutes: a layer having a slow day
 * should not be cut off, but one that has stopped answering should be.
 */
function measuredCollection(measured: LayerSize, cadenceSeconds: number): CollectionPolicyDefinition {
  const maxBytes = Math.ceil(measured.source * 1.34) * MEBIBYTE;
  return {
    cadenceSeconds,
    timeoutSeconds: Math.max(120, Math.ceil((measured.source / SOURCE_MIB_PER_SECOND) * 2)),
    maxBytes,
    maxOutputBytes: Math.max(MEBIBYTE, Math.ceil(measured.output * 1.34) * MEBIBYTE),
    // Doubled, because one row growing is a correction to a boundary rather
    // than a new feature, and capped at the megabyte the kernel stores whole.
    maxRecordBytes: Math.min(MEBIBYTE, Math.max(64 * 1024, Math.ceil(measured.largestRow * 2) * 1024)),
    historyMode: "changes",
  };
}

/** A layer whose budgets come from having read it, polled every week. */
function measuredPolicy(name: string, serving: ServingPolicyDefinition, measured: LayerSize): ExampleFeed["policy"] {
  return { name, version: 3, collection: measuredCollection(measured, WEEK), serving };
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
   * What the feed does with the layer's geometry, decided by reading it: an
   * outline where no row passes the megabyte a record may hold, a point where
   * some do — a municipal agricultural reserve reaches eight megabytes — and
   * nothing at all where the download would dwarf what it buys.
   */
  geometry?: "include" | "point";
  /** The columns worth publishing, where the layer holds one value for the rest of them. */
  properties?: string;
  topics: NonNullable<ExampleFeed["topics"]>;
  /** What one walk of this layer cost when it was read, which is what its budgets are sized from. */
  measured: LayerSize;
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
      "Every municipal delimitation of the Reserva Ecológica Nacional in force on the Portuguese mainland — 399 of them, each an ordinance or notice with the municipality it covers, the area it protects in hectares, whether it is the reserve itself or an exclusion from it, and a link to the act in the Diário da República. Attributes only: each delimitation is drawn across a whole municipality, so the ground it reaches is the municipality, which the charter already publishes.",
    features: 399,
    topics: ["environment", "government"],
    measured: { source: 1, output: 1, largestRow: 1 },
  },
  {
    slug: "dgt-srup-reserva-ecologica-linhas-feed",
    collection: "srup_ren_linear",
    title: "National Ecological Reserve watercourse delimitations",
    description:
      "The 138 linear delimitations of the Reserva Ecológica Nacional — watercourses and the ten-metre beds either side of them — with the act that set each one, its date and the municipality it covers. Attributes only, for the same reason as the areas: a delimitation spans its whole municipality.",
    features: 138,
    topics: ["environment", "government"],
    measured: { source: 1, output: 1, largestRow: 1 },
  },
  {
    slug: "dgt-srup-reserva-agricola-feed",
    collection: "srup_ran",
    title: "National Agricultural Reserve delimitations in force",
    description:
      "The Reserva Agrícola Nacional as delimited for each of 269 mainland municipalities, with the ordinance or notice that set it, the issue of the Diário da República it appeared in, the date it took effect and a link to the act. Attributes only: one delimitation covers its whole municipality and runs to eight megabytes of outline, so reading it would cost a gigabyte and a third a week to say where a municipality is.",
    features: 269,
    properties: "designacao,serv_dr,serv_data,serv_hiperligacao,serv_lei,municipio",
    topics: ["environment", "government"],
    measured: { source: 1, output: 1, largestRow: 1 },
  },
  {
    slug: "dgt-srup-areas-protegidas-feed",
    collection: "srup_areas_protegidas",
    geometry: "point",
    title: "Protected areas as a public-utility restriction",
    description:
      "The 71 classified protected areas of mainland Portugal — national, natural and regional parks, nature reserves, natural monuments and protected landscapes — each placed on the map with the ground it covers, and with the decree that created it, its date, the municipalities it spans and a link to the act. Where each one lies and how far it reaches is published; the outline itself is not, because two of the seventy-one run past the megabyte a record may hold.",
    features: 71,
    topics: ["environment", "government"],
    measured: { source: 34, output: 1, largestRow: 1 },
  },
  {
    slug: "dgt-srup-rede-natura-zec-feed",
    collection: "srup_zec",
    geometry: "include",
    title: "Natura 2000 Special Areas of Conservation",
    description:
      "The 65 Zonas Especiais de Conservação of the Natura 2000 network on the Portuguese mainland, with their outlines, the phase of the national site list each belongs to, the decree that designated it, its date and the municipalities it covers.",
    features: 65,
    topics: ["environment", "government"],
    measured: { source: 53, output: 13, largestRow: 750 },
  },
  {
    slug: "dgt-srup-rede-natura-zpe-feed",
    collection: "srup_zpe",
    geometry: "include",
    title: "Natura 2000 Special Protection Areas",
    description:
      "The 44 Zonas de Proteção Especial for wild birds on the Portuguese mainland, with their outlines, the decree that designated each one, its date, the municipalities it covers and a link to the act.",
    features: 44,
    properties: "designacao,serv_dr,serv_data,serv_hiperligacao,serv_lei,municipio,dtccs",
    topics: ["environment", "government"],
    measured: { source: 17, output: 4, largestRow: 729 },
  },
  {
    slug: "dgt-srup-arvores-interesse-publico-pontos-feed",
    collection: "srup_arvores_point",
    geometry: "include",
    title: "Trees of public interest",
    description:
      "The 551 individual trees and groves classified as being of public interest in mainland Portugal, where each one stands, its species, whether it is a single tree or a group, and the notice that classified it. Lisbon holds 84 of them and Marinha Grande 34; the oldest classification here dates from 1947.",
    features: 551,
    topics: ["environment", "culture"],
    measured: { source: 1, output: 1, largestRow: 1 },
  },
  {
    slug: "dgt-srup-arvores-interesse-publico-areas-feed",
    collection: "srup_arvores_areal",
    geometry: "include",
    title: "Groves of public interest",
    description:
      "The 89 wooded areas classified as being of public interest in mainland Portugal, each with the ground it covers, the species, the act that classified it and the municipality it stands in.",
    features: 89,
    topics: ["environment", "culture"],
    measured: { source: 1, output: 1, largestRow: 11 },
  },
  {
    slug: "dgt-srup-marcos-geodesicos-feed",
    collection: "srup_marcos_geod",
    geometry: "include",
    title: "Geodetic marks and their protection zones",
    description:
      "The 7,968 geodetic marks of mainland Portugal whose surroundings are protected by law, with the name each one is known by, the network it belongs to and the municipality it stands in. Odemira holds 193 of them. What is drawn is the protection zone around each mark rather than the mark itself. Every one of these is protected by the same 1982 decree, which the feed states once rather than on every row. This is the easement side of the register; the survey side, with each mark's order and height, is published separately from the geodetic network itself.",
    features: 7968,
    properties: "designacao,tipologia,municipio,dtccs",
    topics: ["government", "society"],
    measured: { source: 97, output: 25, largestRow: 3 },
  },
  {
    slug: "dgt-srup-aeronautica-feed",
    collection: "srup_aeronautica",
    geometry: "point",
    title: "Airport and aerodrome easements",
    description:
      "The 36 airports and aerodromes of mainland Portugal whose surroundings carry an aeronautical easement, each placed on the map with the ground its easement reaches, and with the decree that established it, its date, the municipalities it covers and a link to the act. The easement surfaces themselves are left at the source: four of the 36 run past the megabyte a record may hold.",
    features: 36,
    topics: ["mobility", "government"],
    measured: { source: 40, output: 1, largestRow: 1 },
  },
  {
    slug: "dgt-srup-albufeiras-feed",
    collection: "srup_albufeiras",
    geometry: "point",
    title: "Classified public water reservoirs",
    description:
      "The 192 classified reservoirs of mainland Portugal, each placed on the map with the water it holds, sorted into protected, conditioned and freely used, with the ordinance that classified it and the municipalities around it. The outlines are left at the source: fifteen of the 192 run past the megabyte a record may hold.",
    features: 192,
    topics: ["environment", "energy"],
    measured: { source: 253, output: 1, largestRow: 1 },
  },
  {
    slug: "dgt-srup-captacoes-aguas-subterraneas-feed",
    collection: "srup_aquiferos",
    geometry: "include",
    title: "Protection zones around public groundwater abstraction",
    description:
      "The 949 protection perimeters around groundwater abstracted for public supply in mainland Portugal, with the ordinance that set each one, its date and the municipality it lies in. Pampilhosa da Serra and Góis hold 155 between them, and each perimeter is drawn.",
    features: 949,
    topics: ["environment", "health"],
    measured: { source: 11, output: 3, largestRow: 358 },
  },
  {
    slug: "dgt-srup-defesa-nacional-feed",
    collection: "srup_defesa_militar",
    geometry: "include",
    title: "National defence easements",
    description:
      "The 152 military installations of mainland Portugal carrying a defence easement — barracks, forts and batteries — each with the ground it occupies, the act that established it, its date and the municipality it stands in. Lisbon holds 20.",
    features: 152,
    topics: ["government"],
    measured: { source: 6, output: 1, largestRow: 725 },
  },
  {
    slug: "dgt-srup-defesa-nacional-zonas-feed",
    collection: "srup_defesa_militar_zonas",
    geometry: "include",
    title: "National defence protection zones",
    description:
      "The 149 protection zones around military installations in mainland Portugal, each with the ground it covers, the act that established it, its date and the municipality it lies in.",
    features: 149,
    topics: ["government"],
    measured: { source: 6, output: 1, largestRow: 378 },
  },
  {
    slug: "dgt-srup-rede-rodoviaria-feed",
    collection: "srup_rede_viaria",
    geometry: "include",
    title: "National road network easements",
    description:
      "The 3,160 stretches of the national road network carrying an easement, each named for the road it belongs to — the A1, the EN2, a link ramp — and sorted into motorway, national road, regional road and municipal road, with the municipality it crosses. Porto holds 121 stretches, and each is drawn as it runs.",
    features: 3160,
    topics: ["mobility", "government"],
    measured: { source: 520, output: 125, largestRow: 423 },
  },
  {
    slug: "dgt-srup-rede-ferroviaria-feed",
    collection: "srup_rede_ferroviaria",
    geometry: "include",
    title: "Railway easements",
    description:
      "The 502 stretches of railway in mainland Portugal carrying an easement, each drawn as it runs, with the act that established it, its date and the municipality it crosses.",
    features: 502,
    topics: ["mobility", "government"],
    measured: { source: 57, output: 14, largestRow: 338 },
  },
  {
    slug: "dgt-srup-estacoes-ferroviarias-feed",
    collection: "srup_rede_ferroviaria_estacoes",
    geometry: "include",
    title: "Railway stations and halts",
    description:
      "The 860 railway stations and halts of mainland Portugal held in the easement register, each where it stands, named and sorted into station, halt, or no longer worked — 298 of them are out of service. Lisbon holds 21. All 860 rest on the same 2003 decree, which the feed states once rather than on every row.",
    features: 860,
    properties: "designacao,tipologia,municipio,dtccs",
    topics: ["mobility", "government"],
    measured: { source: 11, output: 3, largestRow: 3 },
  },
  {
    slug: "dgt-srup-rede-eletrica-feed",
    collection: "srup_rede_eletrica",
    geometry: "include",
    title: "Electricity grid easements",
    description:
      "The 2,456 stretches of the national electricity grid carrying an easement in mainland Portugal, each drawn as it runs, sorted by voltage, with the decree behind it and the municipality it crosses.",
    features: 2456,
    topics: ["energy", "government"],
    measured: { source: 43, output: 11, largestRow: 64 },
  },
  {
    slug: "dgt-sgifr-pontos-feed",
    collection: "sgifr_pontos",
    geometry: "include",
    title: "Rural fire management points",
    description:
      "The 7,841 points held in the sub-regional rural fire management programmes of mainland Portugal: 7,550 water points for firefighting, 172 lookout and detection posts, and the rest strategic fuel-break mosaics. Each carries the intermunicipal body that answers for it, the programme it belongs to and the notice that approved that programme.",
    features: 7841,
    topics: ["environment", "government"],
    measured: { source: 7, output: 4, largestRow: 1 },
  },
];

/** A page worth asking for: small enough that losing one to a dropped connection is cheap to repeat. */
const PAGE_TARGET_BYTES = 16 * MEBIBYTE;

/**
 * How many features to ask for at once, from how big this layer's features
 * turned out to be. A register of a few hundred attribute rows still arrives in
 * one request; a road network whose average stretch is a sixth of a megabyte is
 * asked for a hundred at a time rather than five hundred, because a page that
 * fails is re-read from its offset and a smaller page loses less.
 */
function pageSizeFor(layer: SrupLayer): number {
  const perFeature = (layer.measured.source * MEBIBYTE) / layer.features;
  return Math.max(10, Math.min(500, Math.floor(PAGE_TARGET_BYTES / Math.max(perFeature, 1))));
}

/**
 * A register layer: read whole every week, with room for the pages the count
 * needs. The service publishes no validator, so the cost of a run is the walk
 * itself — which for an attributes-only register is under a second, and for a
 * layer read with its outlines is minutes.
 */
function srupFeed(layer: SrupLayer): ExampleFeed {
  const geometry = layer.geometry ?? "skip";
  const pageSize = pageSizeFor(layer);
  const config: ExampleFeed["config"] = {
    source: "ogc",
    host: DGT_HOST,
    collection: layer.collection,
    geometry,
    pageSize: String(pageSize),
    maxPages: String(Math.max(4, Math.ceil(layer.features / pageSize) + 2)),
  };
  if (layer.properties) config.properties = layer.properties;
  return {
    slug: layer.slug,
    title: layer.title,
    description: layer.description,
    config,
    policy: {
      name: "SRUP weekly register",
      version: 2,
      // A restriction changes when an act is published, which happens a handful
      // of times a year across the whole register, so weekly catches one within
      // days. What that walk costs is the layer's own business: a register read
      // as attributes is a few hundred kilobytes, the same register read with
      // its outlines can be a couple of hundred megabytes, and the budgets come
      // from having read each one.
      collection: measuredCollection(layer.measured, WEEK),
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
      // The walk alone measured 109 seconds, and reading it end to end through
      // the kernel took 292. In production the same run also normalises, stages
      // and writes every row, and 600 seconds was not enough for it; this is
      // room for the whole of that, on a feed that runs once a month.
      timeoutSeconds: 1_800,
      maxBytes: 256 * MEBIBYTE,
      maxOutputBytes: 192 * MEBIBYTE,
      // The largest parcel row measured is 723 bytes.
      maxRecordBytes: 16 * 1024,
      maxRecords: 400_000,
      historyMode: "changes",
    } satisfies CollectionPolicyDefinition,
    serving: dgtServing("Carta do Regime de Uso do Solo"),
  },
  staleAfterSeconds: 2 * MONTH,
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
  /** What one walk of this layer cost when it was read; the same reading the DGT layers get. */
  measured: LayerSize;
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
    measured: { source: 4, output: 4, largestRow: 3 },
  },
  {
    slug: "lneg-sondagens-feed",
    collection: "sondabase-sondagem",
    title: "Boreholes in the national database",
    description: "The 3,497 boreholes in LNEG's SondaBase: where each was drilled, its name, its length, the elevation it started from and the direction it took.",
    features: 3497,
    topics: ["environment", "economy"],
    measured: { source: 1, output: 1, largestRow: 1 },
  },
  {
    slug: "lneg-pontos-de-agua-feed",
    collection: "recursoshidro-pontos-de-gua",
    title: "Groundwater points",
    description:
      "The 5,399 water points in LNEG's groundwater inventory: where each is, the district it lies in, its elevation, what kind of point it is, what it is used for and what it was surveyed for.",
    features: 5399,
    topics: ["environment"],
    measured: { source: 2, output: 2, largestRow: 1 },
  },
  {
    slug: "lneg-sistemas-aquiferos-feed",
    collection: "recursoshidro-sistemas-aqu-feros",
    title: "Aquifer systems",
    description:
      "The 63 aquifer systems of Portugal as LNEG delimits them, with their outlines, the national code each carries, the geological age of the rock that holds the water and the hydrogeological unit each belongs to.",
    features: 63,
    topics: ["environment"],
    measured: { source: 2, output: 2, largestRow: 219 },
  },
  {
    slug: "lneg-falhas-geologicas-feed",
    collection: "cgp1m-ge-geologicfault",
    title: "Geological faults at 1:1,000,000",
    description: "The 297 faults of the harmonised 1:1,000,000 geological map of Portugal, each with the kind of fault it is and the vocabulary term LNEG classifies it under.",
    features: 297,
    topics: ["environment"],
    measured: { source: 1, output: 1, largestRow: 10 },
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
      version: 2,
      // Geology is not news. Monthly is often enough to catch an inventory
      // being extended, and asks the service for one walk every four weeks.
      collection: measuredCollection(layer.measured, MONTH),
      serving: {
        // The service's HTML landing page states CC BY 4.0, exactly as DGT's does.
        licence: "cc-by-4.0",
        attribution: "Laboratório Nacional de Energia e Geologia",
      },
    },
    staleAfterSeconds: 2 * MONTH,
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
   * What each of these does with its outlines was decided by reading it. The
   * parishes and the boundary segments are drawn, because no parish reaches the
   * megabyte a record may hold and they are what almost everything else joins
   * to. The districts, municipalities and NUTS regions are placed instead: each
   * of those layers holds outlines past that megabyte — one district is three
   * and a half of them — and they are in any case the parishes added together,
   * so nothing is lost that cannot be rebuilt from the parishes that are drawn.
   * Placing still means downloading the outline and keeping what says where the
   * area is and how far it reaches; the service offers no way to ask for less.
   */
  {
    slug: "dgt-caop-distritos-feed",
    title: "Mainland Portugal districts, placed (CAOP 2025)",
    description:
      "The 18 districts of mainland Portugal in the official administrative charter: code, name, NUTS 1 region, area, perimeter, and how many municipalities and parishes each holds, with where each one lies and how far it reaches. The outlines themselves are left at the source — one district alone is three and a half megabytes of coastline — and can be rebuilt from the parish boundaries, which are published whole. The Azores and Madeira are not part of this collection.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "distritos",
      geometry: "point",
      pageSize: "10",
      maxPages: "6",
    },
    policy: measuredPolicy("CAOP weekly placed table", DGT_SERVING, { source: 63, output: 1, largestRow: 1 }),
    staleAfterSeconds: 1_209_600,
    publisher: "dgt",
    topics: ["society"],
  },
  {
    slug: "dgt-caop-municipios-feed",
    title: "Mainland Portugal municipalities, placed (CAOP 2025)",
    description:
      "The 278 municipalities of mainland Portugal in the official administrative charter: DTMN code, name, district, the three NUTS levels, area, perimeter, and parish count, with where each one lies and how far it reaches. The outlines themselves are left at the source, because two of the 278 run past the megabyte a record may hold; they can be rebuilt from the parish boundaries, which are published whole. The Azores and Madeira are not part of this collection.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "municipios",
      geometry: "point",
      pageSize: "25",
      maxPages: "14",
    },
    policy: measuredPolicy("CAOP weekly placed table", DGT_SERVING, { source: 194, output: 1, largestRow: 1 }),
    staleAfterSeconds: 1_209_600,
    publisher: "dgt",
    topics: ["society"],
  },
  {
    slug: "dgt-caop-freguesias-feed",
    title: "Mainland Portugal parish boundaries (CAOP 2025)",
    description:
      "The 3,049 civil parishes of mainland Portugal in the official administrative charter, each with the ground it covers: DTMNFR code, name, municipality, district, the three NUTS levels, area and perimeter. This is the boundary nearly everything else joins to — a parcel, an easement or a plan that names a parish can be placed by it, and the municipalities, districts and NUTS regions are these outlines added together. The Azores and Madeira are not part of this collection.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "freguesias",
      geometry: "include",
      pageSize: "100",
      maxPages: "34",
    },
    policy: measuredPolicy("CAOP weekly boundaries", DGT_SERVING, { source: 506, output: 122, largestRow: 671 }),
    staleAfterSeconds: 1_209_600,
    publisher: "dgt",
    topics: ["society"],
  },
  /*
   * The `admin` collection is deliberately not read. It holds the same 3,049
   * parishes split into their 3,392 disjoint parts: an island parish and its
   * mainland part become two rows carrying one parish's code, name, municipality
   * and NUTS levels. The parish feed now publishes each parish's whole outline,
   * multipart and all, so `admin` would republish every one of those columns a
   * second time to say something the geometry already says.
   *
   * `nuts1` is not read either: it is a single row, "Continente", whose columns
   * are the other tables added up.
   */
  {
    slug: "dgt-caop-nuts2-feed",
    title: "Mainland Portugal NUTS II regions, placed (CAOP 2025)",
    description:
      "The seven NUTS II regions the charter covers, with the code, the area in hectares, the perimeter, how many municipalities and parishes each holds, and where each one lies and how far it reaches. These are the regions most Portuguese and European statistics are published by, so they are what a figure keyed to a region can be drawn against. The outlines are left at the source, because the mainland regions pass the megabyte a record may hold. The Azores and Madeira appear here as regions of the statistical hierarchy, though their areas are not part of this collection.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "nuts2",
      geometry: "point",
      pageSize: "10",
      maxPages: "4",
    },
    policy: measuredPolicy("CAOP weekly placed table", DGT_SERVING, { source: 50, output: 1, largestRow: 1 }),
    staleAfterSeconds: 1_209_600,
    publisher: "dgt",
    topics: ["society"],
  },
  {
    slug: "dgt-caop-nuts3-feed",
    title: "Mainland Portugal NUTS III sub-regions, placed (CAOP 2025)",
    description:
      "The 24 NUTS III sub-regions of mainland Portugal, with the code, the NUTS II region and NUTS I level above them, the area in hectares, the perimeter, how many municipalities and parishes each holds, and where each one lies and how far it reaches. This is the level the intermunicipal communities are drawn on and much regional statistics is published by. The outlines are left at the source: two of the 24 run past the megabyte a record may hold. The Azores and Madeira are not part of this collection.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "nuts3",
      geometry: "point",
      pageSize: "10",
      maxPages: "5",
    },
    policy: measuredPolicy("CAOP weekly placed table", DGT_SERVING, { source: 75, output: 1, largestRow: 1 }),
    staleAfterSeconds: 1_209_600,
    publisher: "dgt",
    topics: ["society"],
  },
  {
    slug: "dgt-caop-trocos-feed",
    title: "Mainland Portugal administrative boundary segments (CAOP 2025)",
    description:
      "The 9,899 segments the administrative boundaries of mainland Portugal are drawn from, with the line each one follows: which area lies either side of it, whether it runs on land or along the coast, the order of boundary it carries, whether it is settled or still undefined, and how long it is. Where a parish outline says what an area covers, these say what each stretch of its edge is and who agreed to it.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "trocos",
      geometry: "include",
      pageSize: "500",
      maxPages: "22",
    },
    policy: measuredPolicy("CAOP weekly boundaries", DGT_SERVING, { source: 219, output: 67, largestRow: 397 }),
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
