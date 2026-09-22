import type { DatasetDefinition } from "../../../catalog/define";
import { geo2Feed } from "../wfs";

export const DATASET: DatasetDefinition = {
  title: "Aerial photograph archive index",
  description:
    "Where each of the 29,979 aerial photographs in DGT's Fototeca was taken and when — the earliest here date from 1945 — with the 1:50,000 sheet, the roll, the strip and the frame number that identify the print in the archive. An index of the collection, not the photographs themselves.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Fototeca",
  topics: ["culture", "society"],
  feeds: [
    geo2Feed({
      slug: "dgt-fototeca-index-feed",
      workspace: "fototeca",
      layer: "fototeca",
      // A historical archive: it grows when a collection is catalogued, not weekly.
      cadenceSeconds: 2_592_000,
      // Thirty pages at about six seconds each, on the largest layer read here.
      timeoutSeconds: 600,
      maxRecords: 40_000,
    }),
  ],
};
