import { defineFeed } from "#/catalog/define";
import { ACTIVE_FIRES_MAX_BYTES, ACTIVE_FIRES_NORMALIZER, ACTIVE_FIRES_TRANSFORMER, DATASTORE_DEPLOYMENT, collectActiveFires } from "#/publishers/eumetsat/datastore/index";

export const FEED = defineFeed(DATASTORE_DEPLOYMENT, {
  slug: "eumetsat-active-fires-feed",
  title: "Meteosat active fires over Portugal",
  description:
    "Fires Meteosat Third Generation's imager detects every 10 minutes over mainland Portugal, Madeira and the Azores, each with how sure EUMETSAT's Active Fire Monitoring is of it (likely or possible) and the pixel it was seen in, about 2.5 km across over Portugal. A pixel is a heat signature, not a confirmed wildfire, an ignition point or a burnt area. Mainland fires are kept by a simplified outline of the country, so one within a few kilometres of the Spanish border may fall on either side of it. The current list holds the scans last read; history keeps every fire.",
  licence: "cc-by-4.0",
  attribution: "Contains modified EUMETSAT Meteosat product (MTG FCI Active Fire Monitoring)",
  topics: ["environment"],
  config: { feed: "active-fires" },
  policy: {
    cadenceSeconds: 600,
    timeoutSeconds: 120,
    maxBytes: ACTIVE_FIRES_MAX_BYTES,
    maxRecordBytes: 4 * 1024,
    maxRecords: 50_000,
    historyMode: "changes",
  },
  staleAfterSeconds: 7_200,
  /** Every 10 minutes: a token, the Data Store's list of scans after the last one read, and each new scan's CAP message. */
  fetch: ({ state, library, fetch, now }) => collectActiveFires(state, now(), library.apiOrigin, library.credentials, fetch),
  /** The fires that fall on Portugal, and each region's count of likely and possible fires per scan. */
  transform: { normalizer: ACTIVE_FIRES_NORMALIZER, buffered: (bytes, context) => ACTIVE_FIRES_TRANSFORMER.transform(bytes, context) },
});
