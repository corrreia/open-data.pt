import type { DatasetDefinition } from "#/catalog/define";
import { MYINFO_NETWORK_POLICY, MYINFO_TIMETABLE_POLICY } from "#/formats/myinfo/feeds";

export const DATASET: DatasetDefinition = {
  title: "Ribatejana stops and lines",
  description: "Every bus stop Ribatejana serves in the Ribatejo, with its position, and every line and direction it runs.",
  licence: "source-terms",
  attribution: "Ribatejana via myinfo.4cloud.pt",
  topics: ["mobility"],
  feeds: [
    {
      slug: "ribatejana-network-feed",
      title: "Ribatejana stops and lines",
      description: "Every bus stop Ribatejana serves in the Ribatejo, with its position, and every line and direction it runs.",
      config: { source: "myinfo", feed: "network", operator: "Ribatejana" },
      policy: MYINFO_NETWORK_POLICY,
      staleAfterSeconds: 172_800,
    },
    {
      slug: "ribatejana-foros-salvaterra-marinhais-feed",
      title: "Foros de Salvaterra to Marinhais departures",
      description: "Every scheduled Ribatejana departure from Foros de Salvaterra to Marinhais, with its arrival, journey time, lines and the days it runs.",
      config: { source: "myinfo", feed: "timetable", operator: "Ribatejana", origin: "670", destination: "677" },
      policy: MYINFO_TIMETABLE_POLICY,
      staleAfterSeconds: 172_800,
    },
  ],
};
