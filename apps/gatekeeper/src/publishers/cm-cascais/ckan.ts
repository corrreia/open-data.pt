import type { FeedDefinition } from "../../catalog/define";

export const CASCAIS_DAILY_REFERENCE = {
  name: "Cascais CKAN daily reference snapshot",
  version: 1,
  collection: {
    cadenceSeconds: 86_400,
    timeoutSeconds: 60,
    maxBytes: 10 * 1024 * 1024,
    historyMode: "changes",
  },
} as const;

/** One GeoJSON resource from the Cascais open data portal, collected daily. */
export function cascaisFeed(slug: string, portalDataset: string, resource: string): FeedDefinition {
  return {
    slug,
    config: { source: "ckan", host: "dadosabertos.cascais.pt", dataset: portalDataset, resource },
    policy: CASCAIS_DAILY_REFERENCE,
    staleAfterSeconds: 172_800,
  };
}
