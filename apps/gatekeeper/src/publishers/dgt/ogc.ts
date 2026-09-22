import type { FeedDefinition } from "../../catalog/define";
import { MEBIBYTE, WEEK, measuredCollection, type LayerSize } from "../../formats/ogc/feeds";

export const DGT_HOST = "ogcapi.dgterritorio.gov.pt";

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

/**
 * One layer of the SRUP — the public-utility easements and restrictions in
 * force on the mainland. Every layer carries the same register columns, so what
 * differs between them is which collection is read, how much of it there is,
 * and what the feed does with its geometry.
 */
export interface SrupLayer {
  slug: string;
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
 * The SRUP layers small enough to publish whole. Four are not read: the fire
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
export function srupFeed(layer: SrupLayer): FeedDefinition {
  const geometry = layer.geometry ?? "skip";
  const pageSize = pageSizeFor(layer);
  const config: FeedDefinition["config"] = {
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
 * Every column the CRUS layer holds is asked for, `autor` and `objectid` included.
 * Walking the whole layer they are constant and redundant — `autor` is DGT on
 * all 234,768 parcels and `objectid` equals `fid` on every one — but they are
 * what the charter records about who drew a parcel and what the source calls
 * it, and a reader matching this against DGT's own systems needs them. `Autor`
 * is also half of the pair that says whose data this is: DGT drew it, `fonte`
 * says which municipality's plan it came from.
 */
export const CRUS_COLUMNS =
  "objectid,dtcc,municipio,designacao_no_plano,classe_2021,categoria_2021,escala_origem,fonte,area_ha,autor,data_pub_origem,registo_ou_deposito,situacao_pdm,codigo";
