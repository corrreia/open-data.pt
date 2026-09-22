import type { DatasetDefinition } from "#/catalog/define";
import { CASCAIS_DAILY_REFERENCE, cascaisFeed } from "#/publishers/cm-cascais/ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais street trees",
  description: "Trees standing in public space in Cascais, with their species and the place each stands.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "environment"],
  feeds: [
    // The companion register of felled and transplanted trees (geocascais-arvoreintervencao)
    // is not read: its CSV streams past 48 MB and keeps growing, because it is an append-only
    // log of every intervention ever made. It is the portal's largest file by some way and the
    // least rewarding per byte. Read it if Cascais ever publishes it cut by year.
    {
      ...cascaisFeed("cascais-street-trees-feed", "geocascais-arvore", "25bce551-91b3-4f58-8737-82a3eaabd93a"),
      /*
       * The two tree registers are the portal's largest files by an order of
       * magnitude: 25 MB of outlines for the standing trees and 37 MB for the felled
       * and transplanted ones. Cascais rebuilds every export nightly, but a tree
       * inventory is not a nightly fact, so these are read weekly — enough to catch
       * a season's felling, and a thirtieth of the bytes a daily read would cost.
       */
      policy: {
        ...CASCAIS_DAILY_REFERENCE,
        name: "Cascais CKAN weekly large reference snapshot",
        collection: {
          ...CASCAIS_DAILY_REFERENCE.collection,
          cadenceSeconds: 604_800,
          timeoutSeconds: 300,
          maxBytes: 48 * 1024 * 1024,
          maxOutputBytes: 192 * 1024 * 1024,
        },
      },
      staleAfterSeconds: 1_209_600,
    },
  ],
};
