import { defineFeed } from "#/catalog/define";
import { IPMA_DEPLOYMENT, IPMA_FIRE_MAX_BYTES, IPMA_FIRE_NORMALIZER, IPMA_FIRE_TRANSFORMER, collectIpmaFireDetections } from "#/publishers/ipma/ipma/index";

export const FEED = defineFeed(IPMA_DEPLOYMENT, {
  slug: "ipma-satellite-fire-detections-feed",
  title: "Meteosat fire detections over Portugal",
  description:
    "Fire pixels Meteosat's SEVIRI imager detects every 15 minutes over mainland Portugal, Madeira and the Azores, each with its fire radiative power, from the EUMETSAT LSA SAF FRP-PIXEL product IPMA produces. A pixel, about 4 by 5 km over Portugal, is a heat signature, not a confirmed wildfire, an ignition point or a burnt area. Mainland pixels are kept by a simplified outline of the country, so one within a few kilometres of the Spanish border may fall on either side of it. The current list holds the scans last read; history keeps every detection.",
  licence: "ipma-terms",
  attribution: "IPMA, from the EUMETSAT LSA SAF FRP-PIXEL product",
  topics: ["environment"],
  config: { feed: "fire-detections" },
  policy: {
    cadenceSeconds: 900,
    timeoutSeconds: 120,
    maxBytes: IPMA_FIRE_MAX_BYTES,
    maxRecordBytes: 4 * 1024,
    maxRecords: 50_000,
    historyMode: "changes",
  },
  staleAfterSeconds: 7_200,
  /** Every 15 minutes: the scans published since the last read, two small files each, and nothing when none is new. */
  fetch: ({ state, library, fetch, now }) => collectIpmaFireDetections(state, now(), library.mf2Origin, fetch),
  /** The pixels that fall on Portugal, as detections, and each region's pixel count and total power per scan. */
  transform: { normalizer: IPMA_FIRE_NORMALIZER, buffered: (bytes, context) => IPMA_FIRE_TRANSFORMER.transform(bytes, context) },
});
