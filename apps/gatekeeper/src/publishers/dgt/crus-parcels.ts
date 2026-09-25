import { defineFeed } from "#/catalog/define";
import type { CollectionPolicyDefinition } from "#/index";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { MEBIBYTE, MONTH } from "#/formats/ogc/feeds";
import { CRUS_COLUMNS, DGT_HOST } from "#/publishers/dgt/ogc";

/*
 * The land-use charter's parcel boundaries, one feed per mainland municipality.
 *
 * The service cuts the `crus` collection by municipality itself (`dtcc`, the
 * charter's four-digit code), and a whole municipality comes back in one walk of
 * a few seconds: Lisboa's 861 parcels are 19.6 MB as sent and 5 MB stored,
 * Pombal's 3,876 are 135 MB and 34 MB, the heaviest measured. Each feed is
 * therefore a complete snapshot of its municipality and can say a parcel is gone,
 * which a national layer built up a few municipalities at a time never could.
 *
 * `dgt-crus-feed` reads every parcel's attributes in one national table and keeps
 * their history; these feeds add the outline. They keep no history of their own:
 * a boundary revision is a change the national table already records, and
 * keeping every outline twice would double about a gigabyte of storage.
 */
const CRUS_PARCELS_POLICY = {
  name: "CRUS parcel boundaries by municipality",
  version: 1,
  collection: {
    // A municipal plan is revised over years. Monthly, each at its own time of day.
    cadenceSeconds: MONTH,
    // The heaviest municipality measured sends 135 MB in about ten seconds.
    timeoutSeconds: 600,
    maxBytes: 256 * MEBIBYTE,
    maxOutputBytes: 96 * MEBIBYTE,
    // The largest parcel measured is 970 KiB stored, in Vila Nova de Gaia.
    maxRecordBytes: 1024 * 1024,
    // Chamusca has the most parcels: 5,011.
    maxRecords: 10_000,
    historyMode: "latest",
  } satisfies CollectionPolicyDefinition,
} as const;

/** The parcels of one municipality, `code` being its four-digit DTCC as the charter and the CAOP write it. */
export function crusParcelsFeed(slug: string, code: string, municipality: string, district: string) {
  return defineFeed(OGC_DEPLOYMENT, {
    slug,
    title: `Land-use parcels (CRUS) in ${municipality}`,
    description: `The boundary of every parcel of ${municipality} (district of ${district}) in the Carta do Regime de Uso do Solo, with the class and category of soil its municipal plan puts it in, the designation the plan uses, its area in hectares, and whether that plan is still in force. The same parcels as the national land-use table, which carries their attributes for the whole country and joins these on the parcel's objectid.`,
    licence: "cc-by-4.0",
    attribution: "Direção-Geral do Território — Carta do Regime de Uso do Solo",
    topics: ["cities", "government"],
    config: {
      host: DGT_HOST,
      collection: "crus",
      geometry: "include",
      properties: CRUS_COLUMNS,
      filterField: "dtcc",
      filterValue: code,
      pageSize: "500",
      maxPages: "20",
    },
    policy: CRUS_PARCELS_POLICY,
    staleAfterSeconds: 2 * MONTH,
    /** Once a month: every parcel of the crus layer whose dtcc is this municipality's, with its outline, five hundred a page. */
    fetch: ({ config, library, fetch }) => collectOgcFeed(config, library.hosts, fetch),
    /** The service's pages, streamed, into one table of the municipality's parcel boundaries. */
    transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
  });
}
