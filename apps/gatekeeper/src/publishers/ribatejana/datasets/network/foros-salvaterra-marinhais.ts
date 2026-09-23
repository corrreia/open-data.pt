import { defineFeed } from "#/catalog/define";
import { MYINFO_DEPLOYMENT, MYINFO_NORMALIZER, MYINFO_TRANSFORMER, collectMyInfoFeed } from "#/formats/myinfo/index";
import { MYINFO_TIMETABLE_POLICY } from "#/formats/myinfo/feeds";
import { runTransformer } from "#/index";

export const FEED = defineFeed(MYINFO_DEPLOYMENT, {
  slug: "ribatejana-foros-salvaterra-marinhais-feed",
  title: "Foros de Salvaterra to Marinhais departures",
  description: "Every scheduled Ribatejana departure from Foros de Salvaterra to Marinhais, with its arrival, journey time, lines and the days it runs.",
  config: { feed: "timetable", operator: "Ribatejana", origin: "670", destination: "677" },
  policy: MYINFO_TIMETABLE_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: the operator's journey search between the two zones, which answers with every departure it runs today. */
  fetch: ({ config, validator, library, fetch }) => collectMyInfoFeed(config, validator, library.apiOrigin, library.operators, fetch),
  /** The portal's answer, as MYINFO lays it out, into departures. */
  transform: { normalizer: MYINFO_NORMALIZER, buffered: (bytes, context) => runTransformer(MYINFO_TRANSFORMER, bytes, context) },
});
