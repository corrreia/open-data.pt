import type { DatasetDefinition } from "#/catalog/define";
import { referenceFeed } from "#/formats/gbfs/feeds";
import { birdFeed } from "#/publishers/bird/gbfs";
import { PUBLISHER } from "#/publishers/bird/index";

export const DATASET: DatasetDefinition = {
  title: "Bird vehicles and station availability in Matosinhos",
  description: "Current Bird vehicle positions, fleet counts, and how many vehicles each virtual station holds in Matosinhos.",
  licence: "source-terms",
  attribution: "The GBFS system operator",
  topics: ["mobility"],
  feeds: [birdFeed("matosinhos", "Matosinhos"), referenceFeed("bird-matosinhos", PUBLISHER.name, "Matosinhos", "https://mds.bird.co/gbfs/v2/public/matosinhos/gbfs.json", "en")],
};
