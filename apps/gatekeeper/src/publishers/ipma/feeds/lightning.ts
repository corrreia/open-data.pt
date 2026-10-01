import { defineFeed } from "#/catalog/define";
import { IPMA_DEPLOYMENT, IPMA_LIGHTNING_MAX_BYTES, IPMA_LIGHTNING_NORMALIZER, IPMA_LIGHTNING_TRANSFORMER, collectIpmaLightning } from "#/publishers/ipma/ipma/index";

export const FEED = defineFeed(IPMA_DEPLOYMENT, {
  slug: "ipma-lightning-feed",
  title: "IPMA lightning discharges",
  description:
    "Every atmospheric electrical discharge IPMA's lightning detection network located over mainland Portugal, Madeira and the Azores, with its time, whether it struck the ground or stayed in the clouds, and its peak current. IPMA states the data are informative and not to be used as official in incidents or accidents. Mainland discharges are kept by a simplified outline of the country, so one within a few kilometres of the Spanish border may fall on either side of it. The current list is IPMA's last 24 hours; history keeps every discharge.",
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
  topics: ["environment", "weather"],
  config: { feed: "lightning" },
  policy: {
    cadenceSeconds: 900,
    timeoutSeconds: 60,
    maxBytes: IPMA_LIGHTNING_MAX_BYTES,
    maxRecordBytes: 4 * 1024,
    maxRecords: 200_000,
    historyMode: "changes",
  },
  staleAfterSeconds: 7_200,
  /** Every 15 minutes: the lightning page, one request IPMA answers from its cache, and only when it has changed. */
  fetch: ({ validator, library, fetch }) => collectIpmaLightning(validator, library.webOrigin, fetch),
  /** The page's discharges that fall on Portugal, and each region's count per hour and type. */
  transform: { normalizer: IPMA_LIGHTNING_NORMALIZER, streaming: (body, context) => IPMA_LIGHTNING_TRANSFORMER.transform(body, context) },
});
