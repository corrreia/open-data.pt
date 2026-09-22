import type { FeedDefinition } from "../../catalog/define";
import { MONTH, measuredCollection, type LayerSize } from "../../formats/ogc/feeds";

/*
 * LNEG runs its own pygeoapi at `ogcapi.lneg.pt`. These five are its collections
 * that read as tables rather than as INSPIRE plumbing: the harmonised 1:200,000
 * layers are the same geology under column names the service truncates to
 * `..._representativeli_2`, which no reader can use.
 *
 * All five carry their geometry: the three point layers cost under half a
 * kilobyte a feature, and the two that do not are small enough in count to
 * make up for it.
 */
export interface LnegLayer {
  slug: string;
  collection: string;
  features: number;
  /** What one walk of this layer cost when it was read; the same reading the DGT layers get. */
  measured: LayerSize;
}

export function lnegFeed(layer: LnegLayer): FeedDefinition {
  return {
    slug: layer.slug,
    config: {
      source: "ogc",
      host: "ogcapi.lneg.pt",
      collection: layer.collection,
      geometry: "include",
      pageSize: "500",
      maxPages: String(Math.max(4, Math.ceil(layer.features / 500) + 2)),
    },
    policy: {
      name: "LNEG monthly reference layer",
      version: 2,
      // Geology is not news. Monthly is often enough to catch an inventory
      // being extended, and asks the service for one walk every four weeks.
      collection: measuredCollection(layer.measured, MONTH),
    },
    staleAfterSeconds: 2 * MONTH,
  };
}
