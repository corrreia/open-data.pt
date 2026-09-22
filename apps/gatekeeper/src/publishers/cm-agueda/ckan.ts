import type { FeedDefinition } from "../../catalog/define";
import type { SourceConfig } from "../../index";

/** One slowly changing municipal location inventory, with no live availability claim. */
export function aguedaFeed(slug: string, portalDataset: string, resource: string, options: SourceConfig): FeedDefinition {
  return {
    slug: `agueda-${slug}-feed`,
    config: { source: "ckan", host: "dadosabertos.cm-agueda.pt", dataset: portalDataset, resource, ...options },
    policy: {
      name: "Águeda municipal reference inventory, monthly",
      // Reconfigure the two feeds whose initial origin requests exhausted retries.
      version: slug === "textile-bins" || slug === "waste-operators" ? 2 : 1,
      collection: { cadenceSeconds: 30 * 86_400, timeoutSeconds: 90, maxBytes: 4 * 1024 * 1024, historyMode: "changes" },
    },
    staleAfterSeconds: 90 * 86_400,
  };
}
