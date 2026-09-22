import type { DatasetDefinition } from "../../../catalog/define";
import { MIB, governmentFeed } from "../../../formats/udata/feeds";

export const DATASET: DatasetDefinition = {
  title: "Companies recognised with startup status",
  description:
    "The recognised-startup registry snapshot published by ARTE and Startup Portugal, including the source's file date. Publication licence is not specified in the dataset metadata.",
  licence: "source-terms",
  attribution: "ARTE · Agência para a Reforma Tecnológica do Estado",
  topics: ["government"],
  feeds: [
    governmentFeed({
      slug: "recognised-startups-feed",
      title: "Companies recognised with startup status",
      // ARTE uploads every monthly release as a new resource, so no id is pinned.
      portalDataset: "660c3c451ee8ad9bd6b60608",
      format: "json",
      keyField: "titularNipc",
      eventTimeField: "fileDate",
      cadenceSeconds: 604_800,
      maxBytes: 2 * MIB,
      maxOutputBytes: 8 * MIB,
    }),
  ],
};
