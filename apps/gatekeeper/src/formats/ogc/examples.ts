import type { CollectionPolicyDefinition, ExampleFeed } from "../../index";

const MEBIBYTE = 1024 * 1024;
const DGT_HOST = "ogcapi.dgterritorio.gov.pt";

const HOUR = 3_600;
const WEEK = 604_800;
const MONTH = 2_592_000;

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

/**
 * A layer whose budgets come from having read it, polled every week: the CAOP is
 * republished as a dated edition, not continuously, so weekly is frequent enough
 * to catch a correction.
 */
function measuredPolicy(name: string, measured: LayerSize): ExampleFeed["policy"] {
  return { name, version: 3, collection: measuredCollection(measured, WEEK) };
}

/**
 * One layer of the SRUP — the public-utility easements and restrictions in
 * force on the mainland. Every layer carries the same register columns, so what
 * differs between them is which collection is read, how much of it there is,
 * and what the feed does with its geometry.
 */
interface SrupLayer {
  slug: string;
  /** The dataset this layer is, a key of `DATASETS`. */
  dataset: string;
  collection: string;
  /** Read once from the service, and what the dataset's description promises. */
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
    dataset: "dgt-srup-reserva-ecologica-areas",
    collection: "srup_ren_areal",
    features: 399,
    measured: { source: 1, output: 1, largestRow: 1 },
  },
  {
    slug: "dgt-srup-reserva-ecologica-linhas-feed",
    dataset: "dgt-srup-reserva-ecologica-linhas",
    collection: "srup_ren_linear",
    features: 138,
    measured: { source: 1, output: 1, largestRow: 1 },
  },
  {
    slug: "dgt-srup-reserva-agricola-feed",
    dataset: "dgt-srup-reserva-agricola",
    collection: "srup_ran",
    properties: "designacao,serv_dr,serv_data,serv_hiperligacao,serv_lei,municipio",
    features: 269,
    measured: { source: 1, output: 1, largestRow: 1 },
  },
  {
    slug: "dgt-srup-areas-protegidas-feed",
    dataset: "dgt-srup-areas-protegidas",
    collection: "srup_areas_protegidas",
    geometry: "point",
    features: 71,
    measured: { source: 34, output: 1, largestRow: 1 },
  },
  {
    slug: "dgt-srup-rede-natura-zec-feed",
    dataset: "dgt-srup-rede-natura-zec",
    collection: "srup_zec",
    geometry: "include",
    features: 65,
    measured: { source: 53, output: 13, largestRow: 750 },
  },
  {
    slug: "dgt-srup-rede-natura-zpe-feed",
    dataset: "dgt-srup-rede-natura-zpe",
    collection: "srup_zpe",
    geometry: "include",
    properties: "designacao,serv_dr,serv_data,serv_hiperligacao,serv_lei,municipio,dtccs",
    features: 44,
    measured: { source: 17, output: 4, largestRow: 729 },
  },
  {
    slug: "dgt-srup-arvores-interesse-publico-pontos-feed",
    dataset: "dgt-srup-arvores-interesse-publico-pontos",
    collection: "srup_arvores_point",
    geometry: "include",
    features: 551,
    measured: { source: 1, output: 1, largestRow: 1 },
  },
  {
    slug: "dgt-srup-arvores-interesse-publico-areas-feed",
    dataset: "dgt-srup-arvores-interesse-publico-areas",
    collection: "srup_arvores_areal",
    geometry: "include",
    features: 89,
    measured: { source: 1, output: 1, largestRow: 11 },
  },
  {
    slug: "dgt-srup-marcos-geodesicos-feed",
    dataset: "dgt-srup-marcos-geodesicos",
    collection: "srup_marcos_geod",
    geometry: "include",
    properties: "designacao,tipologia,municipio,dtccs",
    features: 7968,
    measured: { source: 97, output: 25, largestRow: 3 },
  },
  {
    slug: "dgt-srup-aeronautica-feed",
    dataset: "dgt-srup-aeronautica",
    collection: "srup_aeronautica",
    geometry: "point",
    features: 36,
    measured: { source: 40, output: 1, largestRow: 1 },
  },
  {
    slug: "dgt-srup-albufeiras-feed",
    dataset: "dgt-srup-albufeiras",
    collection: "srup_albufeiras",
    geometry: "point",
    features: 192,
    measured: { source: 253, output: 1, largestRow: 1 },
  },
  {
    slug: "dgt-srup-captacoes-aguas-subterraneas-feed",
    dataset: "dgt-srup-captacoes-aguas-subterraneas",
    collection: "srup_aquiferos",
    geometry: "include",
    features: 949,
    measured: { source: 11, output: 3, largestRow: 358 },
  },
  {
    slug: "dgt-srup-defesa-nacional-feed",
    dataset: "dgt-srup-defesa-nacional",
    collection: "srup_defesa_militar",
    geometry: "include",
    features: 152,
    measured: { source: 6, output: 1, largestRow: 725 },
  },
  {
    slug: "dgt-srup-defesa-nacional-zonas-feed",
    dataset: "dgt-srup-defesa-nacional-zonas",
    collection: "srup_defesa_militar_zonas",
    geometry: "include",
    features: 149,
    measured: { source: 6, output: 1, largestRow: 378 },
  },
  {
    slug: "dgt-srup-rede-rodoviaria-feed",
    dataset: "dgt-srup-rede-rodoviaria",
    collection: "srup_rede_viaria",
    geometry: "include",
    features: 3160,
    measured: { source: 520, output: 125, largestRow: 423 },
  },
  {
    slug: "dgt-srup-rede-ferroviaria-feed",
    dataset: "dgt-srup-rede-ferroviaria",
    collection: "srup_rede_ferroviaria",
    geometry: "include",
    features: 502,
    measured: { source: 57, output: 14, largestRow: 338 },
  },
  {
    slug: "dgt-srup-estacoes-ferroviarias-feed",
    dataset: "dgt-srup-estacoes-ferroviarias",
    collection: "srup_rede_ferroviaria_estacoes",
    geometry: "include",
    properties: "designacao,tipologia,municipio,dtccs",
    features: 860,
    measured: { source: 11, output: 3, largestRow: 3 },
  },
  {
    slug: "dgt-srup-rede-eletrica-feed",
    dataset: "dgt-srup-rede-eletrica",
    collection: "srup_rede_eletrica",
    geometry: "include",
    features: 2456,
    measured: { source: 43, output: 11, largestRow: 64 },
  },
  {
    slug: "dgt-sgifr-pontos-feed",
    dataset: "dgt-sgifr-pontos",
    collection: "sgifr_pontos",
    geometry: "include",
    features: 7841,
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
    dataset: layer.dataset,
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
    },
    // Two weeks: an act published the day after a run should not make the feed
    // look stale before the next one has had a chance to catch it.
    staleAfterSeconds: 2 * WEEK,
  };
}

/*
 * The Carta do Regime de Uso do Solo is one dataset — every parcel of mainland
 * Portugal, classified the same way — so it is one feed and one product.
 *
 * It is also 234,768 parcels and 191 MB, read in 47 pages of five thousand.
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
 * all 234,768 parcels and `objectid` equals `fid` on every one — but they are
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
 * Every parcel's boundary comes to 4.7 GiB and a quarter of an hour of
 * streaming, from a service that loses a connection every few minutes — one
 * sitting will not do it. So it is read a few municipalities a run, each one
 * twenty-two megabytes and a few seconds, and the runs pile up into a single
 * dataset: the kernel merges a partial snapshot into what is already served
 * rather than replacing it.
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
  dataset: "dgt-crus-shapes",
  config: {
    source: "ogc",
    host: DGT_HOST,
    collection: "crus",
    geometry: "include",
    properties: CRUS_COLUMNS,
    shardField: "dtcc",
    shardSource: "municipios",
    shardSourceField: "dtmn",
    /*
     * Twenty-four municipalities a run, which is twelve runs for the country.
     * Every one of the 278 was counted: 234,768 parcels, and at the 21 KiB of
     * pretty-printed outline a parcel averages, a run of twenty-four reads 401
     * MiB on average and 495 MiB at its worst. Shards are taken in code order,
     * so a run reads municipalities from the same district and the worst group
     * is a real one, not a coincidence — and a run that runs out of bytes never
     * reaches its completion frame, so its cursor never moves and the feed would
     * wedge on that group for good. The budget below covers the worst group with
     * room, rather than the average with none.
     */
    shardsPerRun: "24",
    pageSize: "500",
    maxPages: "60",
  },
  policy: {
    name: "CRUS parcel boundaries",
    version: 2,
    collection: {
      /*
       * Hourly, which is not a claim that the charter changes hourly. A run
       * reads a different twelfth of the country, so what this sets is how long
       * the map takes to fill: twelve hours, against the three months a weekly
       * run needed — which is why the country has been showing in patches.
       *
       * It is the one feed here polled faster than a week, and it is the only
       * one whose runs do not repeat work: each reads municipalities the last
       * did not. Once the country is covered this keeps re-reading every parcel
       * twice a day, which is more than a land-use charter warrants; the cost
       * is about fifteen seconds of parsing a run and no writes where nothing
       * changed, so it is affordable rather than right, and the cadence should
       * come back to a week once the first pass is in.
       */
      cadenceSeconds: HOUR,
      timeoutSeconds: 600,
      // The worst group measured is 495 MiB; a fifth again on top of that.
      maxBytes: 640 * MEBIBYTE,
      // Stored rows are compact where the source is pretty-printed, so the
      // output of even the worst group is nearer 130 MiB than its 495.
      maxOutputBytes: 256 * MEBIBYTE,
      // The largest parcel boundary measured over 3,600 sampled is 749 KiB.
      maxRecordBytes: 1024 * 1024,
      maxRecords: 400_000,
      historyMode: "changes",
    } satisfies CollectionPolicyDefinition,
  },
  // Three days without a successful run is a feed that has stopped, not a slice
  // waiting its turn: this measures time since the last success, not data age.
  staleAfterSeconds: 6 * HOUR,
};

const CRUS_NATIONAL: ExampleFeed = {
  slug: "dgt-crus-feed",
  dataset: "dgt-crus",
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
  },
  staleAfterSeconds: 2 * MONTH,
};

/*
 * LNEG runs its own pygeoapi at `ogcapi.lneg.pt`. These five are its collections
 * that read as tables rather than as INSPIRE plumbing: the harmonised 1:200,000
 * layers are the same geology under column names the service truncates to
 * `..._representativeli_2`, which no reader can use.
 *
 * All five carry their geometry: the three point layers cost under half a
 * kilobyte a feature, and the two that do not are small enough in count to
 * make up for it.
 */
interface LnegLayer {
  slug: string;
  /** The dataset this layer is, a key of `DATASETS`. */
  dataset: string;
  collection: string;
  features: number;
  /** What one walk of this layer cost when it was read; the same reading the DGT layers get. */
  measured: LayerSize;
}

const LNEG_LAYERS: LnegLayer[] = [
  {
    slug: "lneg-ocorrencias-minerais-feed",
    dataset: "lneg-ocorrencias-minerais",
    collection: "siorminp-mineral-occurrences",
    features: 5483,
    measured: { source: 4, output: 4, largestRow: 3 },
  },
  {
    slug: "lneg-sondagens-feed",
    dataset: "lneg-sondagens",
    collection: "sondabase-sondagem",
    features: 3497,
    measured: { source: 1, output: 1, largestRow: 1 },
  },
  {
    slug: "lneg-pontos-de-agua-feed",
    dataset: "lneg-pontos-de-agua",
    collection: "recursoshidro-pontos-de-gua",
    features: 5399,
    measured: { source: 2, output: 2, largestRow: 1 },
  },
  {
    slug: "lneg-sistemas-aquiferos-feed",
    dataset: "lneg-sistemas-aquiferos",
    collection: "recursoshidro-sistemas-aqu-feros",
    features: 63,
    measured: { source: 2, output: 2, largestRow: 219 },
  },
  {
    slug: "lneg-falhas-geologicas-feed",
    dataset: "lneg-falhas-geologicas",
    collection: "cgp1m-ge-geologicfault",
    features: 297,
    measured: { source: 1, output: 1, largestRow: 10 },
  },
];

function lnegFeed(layer: LnegLayer): ExampleFeed {
  return {
    slug: layer.slug,
    dataset: layer.dataset,
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
    },
    staleAfterSeconds: 2 * MONTH,
  };
}

/*
 * The DGT service publishes seventy-five collections. Thirty-nine are rasters,
 * which a feature reader has no business with — the orthophotos and the Sentinel
 * mosaics are indexed by the `stac` library from the Centro de Dados instead.
 * Of the thirty-four feature collections, these are read and the rest are left
 * on purpose, having been looked at:
 *
 *   cos2018v4, cos2025v1   The land cover charter: 1,094,335 and 1,104,426
 *                          polygons, four and a half times the land-use regime
 *                          this file already reads a few municipalities at a
 *                          time. Reachable by the same sharded walk, and a real
 *                          commitment of storage rather than an oversight.
 *   cadastro               1,817,861 cadastral parcels.
 *   srup_perigosidade_inc_rural, sgifr_areas, sgifr_linhas
 *                          1,787,684, 490,437 and 239,863 features: national
 *                          coverages rather than registers.
 *   nuts1                  One row, "Continente", whose columns are the other
 *                          tables added up.
 *   admin                  The parishes split into their 3,392 disjoint parts,
 *                          which the parish outlines now say in themselves.
 *
 * Two are catalogues rather than data, and would be a different kind of feed:
 * `snig` holds 4,580 metadata records describing every official geographic
 * dataset in the country, and `point` 322 describing municipal plans, which the
 * `snit` library already reads as the plans themselves.
 *
 * DGT's imagery is not read at all, and the reason is worth keeping because it
 * is not obvious. Its Centro de Dados publishes a catalogue of twenty-one
 * coverages — nine of orthophotos from 1995 to 2025, and the twelve of the 2024
 * LiDAR, seven of them over the Azores and five over the mainland. A `stac`
 * library read the orthophotos as tile indexes until September 2026, and the
 * indexes turned out to say almost nothing: of eighteen columns, ten held one
 * value for a whole coverage, `fileBytes` was null on every row of every year,
 * and what was left was a rectangle from a regular grid and a link. Every one of
 * those links — and every LiDAR asset, which redirects to a Keycloak login —
 * answers an anonymous request with 403. Twenty-two thousand rows to say what
 * nine facts say: which coverage flew where, at what resolution, in which year.
 * So the feeds and the library went. Restoring any of it needs DGT to open the
 * files, not more code.
 */
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
    dataset: "dgt-caop-administrative-areas",
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
    policy: measuredPolicy("CAOP weekly placed table", { source: 63, output: 1, largestRow: 1 }),
    staleAfterSeconds: 1_209_600,
  },
  {
    slug: "dgt-caop-municipios-feed",
    dataset: "dgt-caop-administrative-areas",
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
    policy: measuredPolicy("CAOP weekly placed table", { source: 194, output: 1, largestRow: 1 }),
    staleAfterSeconds: 1_209_600,
  },
  {
    slug: "dgt-caop-freguesias-feed",
    dataset: "dgt-caop-administrative-areas",
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
    policy: measuredPolicy("CAOP weekly boundaries", { source: 506, output: 122, largestRow: 671 }),
    staleAfterSeconds: 1_209_600,
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
    dataset: "dgt-caop-administrative-areas",
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
    policy: measuredPolicy("CAOP weekly placed table", { source: 50, output: 1, largestRow: 1 }),
    staleAfterSeconds: 1_209_600,
  },
  {
    slug: "dgt-caop-nuts3-feed",
    dataset: "dgt-caop-administrative-areas",
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
    policy: measuredPolicy("CAOP weekly placed table", { source: 75, output: 1, largestRow: 1 }),
    staleAfterSeconds: 1_209_600,
  },
  {
    slug: "dgt-caop-trocos-feed",
    dataset: "dgt-caop-administrative-areas",
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
    policy: measuredPolicy("CAOP weekly boundaries", { source: 219, output: 67, largestRow: 397 }),
    staleAfterSeconds: 1_209_600,
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
