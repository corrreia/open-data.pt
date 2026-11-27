import { defineFeed } from "#/catalog/define";
import {
  IPMA_DEPLOYMENT,
  IPMA_WARNING_AREAS_MAX_BYTES,
  IPMA_WARNING_AREAS_NORMALIZER,
  IPMA_WARNING_AREAS_TRANSFORMER,
  collectIpmaWarningAreas,
} from "#/publishers/ipma/ipma/index";

export const FEED = defineFeed(IPMA_DEPLOYMENT, {
  slug: "ipma-warning-areas-feed",
  title: "IPMA weather warning areas",
  description:
    "The outline of every area IPMA issues weather warnings for: the 18 mainland districts, four parts of Madeira and the three island groups of the Azores, and the strip of sea off each coastal one, which is a separate outline under the same code. `areaCode` is the `areaCode` of IPMA's weather warnings, so a warning can be drawn on a map; IPMA's data does not say which warnings apply to the land outline and which to the sea one. These are the simplified outlines IPMA's own warnings map draws, read from its website rather than its documented API, and unchanged since October 2021. `emmaId` is the MeteoAlarm code as the files state it: Madeira's land file repeats mainland codes, and the Azores' land file has none.",
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
  topics: ["environment", "weather"],
  config: { feed: "warning-areas" },
  policy: {
    cadenceSeconds: 604_800,
    timeoutSeconds: 60,
    maxBytes: IPMA_WARNING_AREAS_MAX_BYTES,
    maxRecordBytes: 512 * 1024,
    historyMode: "changes",
  },
  staleAfterSeconds: 2 * 604_800 + 86_400,
  /** Once a week: the six outline files of IPMA's warnings map, all of them every time. */
  fetch: ({ library, fetch }) => collectIpmaWarningAreas(library.webOrigin, fetch),
  /** The files' outlines, into one record per area and surface. */
  transform: { normalizer: IPMA_WARNING_AREAS_NORMALIZER, streaming: (body, context) => IPMA_WARNING_AREAS_TRANSFORMER.transform(body, context) },
});
