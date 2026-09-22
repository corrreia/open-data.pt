import type { FeedDefinition } from "../../../catalog/define";
import type { RenServiceName } from "./ren";

/** One REN chart service, read at its dataset's policy and marked stale after an hour. */
export function renChartFeed(service: RenServiceName, policy: FeedDefinition["policy"], title: string, description: string): FeedDefinition {
  return {
    slug: `ren-${service}-feed`,
    title,
    description,
    config: { source: "ren", service },
    policy,
    staleAfterSeconds: 3600,
  };
}
