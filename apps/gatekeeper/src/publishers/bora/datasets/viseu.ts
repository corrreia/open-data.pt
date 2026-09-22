import type { DatasetDefinition } from "#/catalog/define";
import { DOCKED_POLICY, referenceFeed } from "#/formats/gbfs/feeds";
import { PUBLISHER } from "#/publishers/bora/index";

export const DATASET: DatasetDefinition = {
  title: "Bora bicycles and station availability in Viseu Dão Lafões",
  description: "Current Bora bicycle positions, fleet counts, and how many bicycles and docks each station holds.",
  licence: "source-terms",
  attribution: "The GBFS system operator",
  topics: ["mobility"],
  feeds: [
    {
      slug: "bora-viseu",
      title: "Bora bicycles and station availability in Viseu Dão Lafões",
      description: "Current Bora bicycle positions, fleet counts, and how many bicycles and docks each station holds.",
      config: {
        source: "gbfs",
        url: "https://gbfs.primelayer.pt/gbfs-smartmobility/gbfs/v3/gbfs.json",
        language: "pt",
        feed: "status",
      },
      policy: DOCKED_POLICY,
      staleAfterSeconds: 1800,
    },
    referenceFeed("bora-viseu", PUBLISHER.name, "Viseu Dão Lafões", "https://gbfs.primelayer.pt/gbfs-smartmobility/gbfs/v3/gbfs.json", "pt"),
  ],
};
