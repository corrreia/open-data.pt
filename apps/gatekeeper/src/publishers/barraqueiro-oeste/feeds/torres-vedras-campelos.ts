import { defineFeed } from "#/catalog/define";
import { MYINFO_DEPLOYMENT, MYINFO_NORMALIZER, MYINFO_TRANSFORMER, collectMyInfoFeed } from "#/formats/myinfo/index";
import { MYINFO_TIMETABLE_POLICY } from "#/formats/myinfo/feeds";
import { runTransformer } from "#/index";

export const FEED = defineFeed(MYINFO_DEPLOYMENT, {
  slug: "barraqueiro-oeste-torres-vedras-campelos-feed",
  title: "Torres Vedras to Campelos departures",
  description: "Every scheduled Barraqueiro Oeste departure from Torres Vedras to Campelos, with its arrival, journey time, lines and the days it runs.",
  licence: "source-terms",
  attribution: "Barraqueiro Oeste via myinfo.4cloud.pt",
  topics: ["mobility"],
  config: { feed: "timetable", operator: "BarraqueiroOeste", origin: "4384", destination: "4422" },
  policy: MYINFO_TIMETABLE_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: the operator's journey search between the two zones, which answers with every departure it runs today. */
  fetch: ({ config, validator, library, fetch }) => collectMyInfoFeed(config, validator, library.apiOrigin, library.operators, fetch),
  /** The portal's answer, as MYINFO lays it out, into departures. */
  transform: { normalizer: MYINFO_NORMALIZER, buffered: (bytes, context) => runTransformer(MYINFO_TRANSFORMER, bytes, context) },
});
