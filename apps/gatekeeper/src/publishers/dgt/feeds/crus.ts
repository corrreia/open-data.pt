import { defineFeed } from "#/catalog/define";
import type { CollectionPolicyDefinition } from "#/index";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { MEBIBYTE, MONTH } from "#/formats/ogc/feeds";
import { CRUS_COLUMNS, DGT_HOST } from "#/publishers/dgt/ogc";

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
 * The outlines are not collected. What this table adds to DGT's own service is
 * the history of every parcel's class; the outlines DGT already serves whole,
 * one link away, and a copy of them here was a second set of 278 products that
 * repeated these columns and could not hold the largest parcels unsimplified.
 */
export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-crus-feed",
  title: "Mainland Portugal land-use regime (CRUS)",
  description:
    "Every parcel of mainland Portugal in the Carta do Regime de Uso do Solo — 234,768 of them, across all 278 municipalities — with the class and category of soil its municipal plan puts it in, the designation the plan uses, its area in hectares, the scale it was drawn at, where DGT took it from, whether the plan behind it is still in force, and that plan's deposit reference and publication date. Attributes only: the parcel outlines stay at DGT, about a gigabyte of them, and each row links to its parcel's page in DGT's service, outline included, in _source_url.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Carta do Regime de Uso do Solo",
  topics: ["cities", "government"],
  config: {
    host: DGT_HOST,
    collection: "crus",
    geometry: "skip",
    properties: CRUS_COLUMNS,
    pageSize: "5000",
    maxPages: "60",
  },
  policy: {
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
  staleAfterSeconds: 2 * MONTH,
  /** Once a month: every parcel of the crus layer from DGT's OGC API, its columns without outlines, five thousand a page. */
  fetch: ({ config, library, fetch }) => collectOgcFeed(config, library.hosts, fetch),
  /** The service's pages, streamed, into one table of parcels. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
