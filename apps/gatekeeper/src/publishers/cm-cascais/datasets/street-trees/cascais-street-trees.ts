import { defineFeed } from "#/catalog/define";
import { CKAN_DEPLOYMENT, CKAN_NORMALIZER, CkanSource, transformCkan } from "#/formats/ckan/index";
import { CASCAIS_DAILY_REFERENCE, CASCAIS_HOST } from "#/publishers/cm-cascais/ckan";

export const FEED = defineFeed(CKAN_DEPLOYMENT, {
  slug: "cascais-street-trees-feed",
  config: { host: CASCAIS_HOST, dataset: "geocascais-arvore", resource: "25bce551-91b3-4f58-8737-82a3eaabd93a" },
  /*
   * The two tree registers are the portal's largest files by an order of
   * magnitude: 25 MB of outlines for the standing trees and 37 MB for the felled
   * and transplanted ones. Cascais rebuilds every export nightly, but a tree
   * inventory is not a nightly fact, so these are read weekly — enough to catch
   * a season's felling, and a thirtieth of the bytes a daily read would cost.
   */
  policy: {
    ...CASCAIS_DAILY_REFERENCE,
    name: "Cascais CKAN weekly large reference snapshot",
    collection: {
      ...CASCAIS_DAILY_REFERENCE.collection,
      cadenceSeconds: 604_800,
      timeoutSeconds: 300,
      maxBytes: 48 * 1024 * 1024,
      maxOutputBytes: 192 * 1024 * 1024,
    },
  },
  staleAfterSeconds: 1_209_600,
  /** Once a week: the geocascais-arvore resource on Cascais's CKAN portal, downloaded only when it has changed. */
  fetch: ({ config, validator, library, fetch }) => new CkanSource(library.hosts, fetch).collect(config, validator),
  /** The resource, as the portal serves it, into one table of Cascais's street trees. */
  transform: { normalizer: CKAN_NORMALIZER, streaming: (body, context, metadata) => transformCkan(body, context, metadata) },
});
