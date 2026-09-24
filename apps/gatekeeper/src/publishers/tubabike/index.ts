import type { PublisherDefinition } from "#/catalog/define";
import { FEED as barcelosReference } from "./feeds/barcelos-reference";
import { FEED as barcelos } from "./feeds/barcelos";

export const PUBLISHER: PublisherDefinition = {
  name: "TubaBike",
  sources: ["gbfs.nextbike.net"],
  logo: "svg",
  feeds: [
    /*
     * TubaBike is the one system here that fills GBFS's own licence field —
     * `"license_id": "CC0-1.0"` in its `system_information.json` — which is why its
     * feeds are collected under policies of their own.
     */
    barcelosReference,
    barcelos,
  ],
};
