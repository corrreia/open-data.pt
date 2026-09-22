import type { DatasetDefinition } from "../../../catalog/define";
import { DOCKED_POLICY, REFERENCE_POLICY, referenceFeed } from "../../../formats/gbfs/feeds";
import { PUBLISHER } from "../index";

/*
 * TubaBike is the one system here that fills GBFS's own licence field —
 * `"license_id": "CC0-1.0"` in its `system_information.json` — which is why its
 * feeds are collected under policies of their own.
 */
const TUBABIKE_POLICY = { ...DOCKED_POLICY, name: "GBFS docked system snapshots, ten minutes, dedicated" } as const;

const TUBABIKE_REFERENCE_POLICY = { ...REFERENCE_POLICY, name: "GBFS system and station reference, daily, dedicated" } as const;

export const DATASET: DatasetDefinition = {
  title: "TubaBike bicycles and station availability in Barcelos",
  description: "Current TubaBike bicycle positions, fleet counts, and how many bicycles and docks each station holds.",
  licence: "cc0-1.0",
  attribution: "TubaBike — Mobilidade de Barcelos",
  topics: ["mobility"],
  feeds: [
    {
      slug: "tubabike-barcelos",
      title: "TubaBike bicycles and station availability in Barcelos",
      description: "Current TubaBike bicycle positions, fleet counts, and how many bicycles and docks each station holds.",
      config: {
        source: "gbfs",
        url: "https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_bx/gbfs.json",
        language: "pt",
        feed: "status",
      },
      policy: TUBABIKE_POLICY,
      staleAfterSeconds: 1800,
    },
    referenceFeed("tubabike-barcelos", PUBLISHER.name, "Barcelos", "https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_bx/gbfs.json", "pt", TUBABIKE_REFERENCE_POLICY),
  ],
};
