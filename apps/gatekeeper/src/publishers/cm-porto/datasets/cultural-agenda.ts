import type { DatasetDefinition } from "../../../catalog/define";
import { DAILY_REFERENCE, PORTO_HOST } from "../ckan";

export const DATASET: DatasetDefinition = {
  title: "Porto cultural agenda",
  description: "Published cultural events with descriptions, schedules, and locations.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal do Porto via dadosabertos.cm-porto.pt",
  topics: ["cities", "culture"],
  feeds: [
    {
      slug: "porto-cultural-agenda-feed",
      config: {
        source: "ckan",
        host: PORTO_HOST,
        dataset: "apd-pontos-de-interesse-cultura-e-patrimonio-agenda-cultural",
        resource: "e246f08d-b4d0-4955-ae82-07b516c4c747",
      },
      policy: { ...DAILY_REFERENCE, name: "Porto CKAN daily event changes" },
      staleAfterSeconds: 172_800,
    },
  ],
};
