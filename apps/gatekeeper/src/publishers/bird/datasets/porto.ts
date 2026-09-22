import type { DatasetDefinition } from "../../../catalog/define";
import { referenceFeed } from "../../../formats/gbfs/feeds";
import { birdFeed } from "../gbfs";
import { PUBLISHER } from "../index";

export const DATASET: DatasetDefinition = {
  title: "Bird vehicles and station availability in Porto",
  description: "Current Bird vehicle positions, fleet counts, and how many vehicles each virtual station holds in Porto.",
  licence: "source-terms",
  attribution: "The GBFS system operator",
  topics: ["mobility"],
  feeds: [birdFeed("porto", "Porto"), referenceFeed("bird-porto", PUBLISHER.name, "Porto", "https://mds.bird.co/gbfs/v2/public/porto/gbfs.json", "en")],
};
