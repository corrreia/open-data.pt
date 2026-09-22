import type { DatasetDefinition } from "#/catalog/define";
import { renChartFeed } from "#/publishers/ren/ren/feeds";

/** REN completes an electricity quarter-hour only twice an hour, so a faster cadence can never see a new point. */
const ELECTRICITY_POLICY = {
  name: "REN intraday chart data",
  version: 3,
  collection: {
    cadenceSeconds: 1_800,
    timeoutSeconds: 30,
    maxBytes: 2 * 1024 * 1024,
    historyMode: "changes",
  },
} as const;

export const DATASET: DatasetDefinition = {
  title: "REN electricity system",
  description: "How Portugal's electricity is generated, what share is renewable, what crosses the border, and what capacity is installed.",
  licence: "ren-datahub",
  attribution: "REN — Redes Energéticas Nacionais",
  topics: ["energy"],
  feeds: [
    renChartFeed(
      "production-breakdown",
      ELECTRICITY_POLICY,
      "REN electricity production breakdown",
      "Quarter-hour electricity consumption, generation by source, storage, and import balance.",
    ),
    // The consumption service reads the same chart as production-breakdown, whose Consumption series already publishes these numbers.
    renChartFeed(
      "renewables-share",
      ELECTRICITY_POLICY,
      "REN renewable and non-renewable electricity",
      "Quarter-hour renewable generation, non-renewable generation, consumption, and import balance.",
    ),
    renChartFeed(
      "interconnection-exchanges",
      ELECTRICITY_POLICY,
      "REN electricity interconnection exchanges",
      "Quarter-hour electricity imports and exports across Portugal's interconnections.",
    ),
    {
      slug: "ren-installed-capacity-feed",
      title: "REN installed generating capacity",
      description:
        "Installed generating capacity by source for the latest three completed calendar months available from REN. Unpublished and null observations are not reported as zero.",
      config: { source: "ren", service: "installed-capacity" },
      policy: {
        name: "REN monthly capacity",
        version: 2,
        collection: { cadenceSeconds: 604_800, timeoutSeconds: 90, maxBytes: 512 * 1024, historyMode: "changes" },
      },
      staleAfterSeconds: 1_209_600,
    },
  ],
};
