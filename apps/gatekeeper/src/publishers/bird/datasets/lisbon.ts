import type { DatasetDefinition } from "#/catalog/define";
import { REALTIME_POLICY, referenceFeed } from "#/formats/gbfs/feeds";
import { PUBLISHER } from "#/publishers/bird/index";

export const DATASET: DatasetDefinition = {
  title: "Bird vehicles and station availability in Lisbon",
  description: "Current Bird vehicle positions, fleet counts, and how many vehicles each Lisbon virtual station holds.",
  licence: "source-terms",
  attribution: "The GBFS system operator",
  topics: ["mobility"],
  feeds: [
    {
      slug: "bird-lisbon",
      title: "Bird vehicles and station availability in Lisbon",
      description: "Current Bird vehicle positions, fleet counts, and how many vehicles each Lisbon virtual station holds.",
      config: {
        source: "gbfs",
        url: "https://mds.bird.co/gbfs/v2/public/lisbon/gbfs.json",
        language: "en",
        feed: "status",
      },
      policy: REALTIME_POLICY,
      staleAfterSeconds: 600,
    },
    referenceFeed("bird-lisbon", PUBLISHER.name, "Lisbon", "https://mds.bird.co/gbfs/v2/public/lisbon/gbfs.json", "en"),
  ],
};
