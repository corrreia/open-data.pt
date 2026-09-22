import type { DatasetDefinition, FeedDefinition } from "../../../catalog/define";
import { SNIRH_READINGS, type SnirhReadingName } from "../snirh";
import { SNIRH_DAILY_POLICY, SNIRH_HOURLY_POLICY, SNIRH_MONTHLY_POLICY } from "../snirh/feeds";

function reading(slug: string, name: SnirhReadingName, policy: FeedDefinition["policy"]): FeedDefinition {
  const definition = SNIRH_READINGS[name];
  return {
    slug,
    title: `Portugal ${definition.title.toLowerCase()}`,
    description: `${definition.description} Readings come from SNIRH's station database, usually within a day of being taken.`,
    config: { source: "snirh", feed: "readings", reading: name },
    policy,
    staleAfterSeconds: Math.max(172_800, policy.collection.cadenceSeconds * 3),
  };
}

export const DATASET: DatasetDefinition = {
  title: "SNIRH station measurements",
  description: "What APA's monitoring network measures at each station: river levels and flows, reservoir levels and storage, groundwater levels, and hourly weather.",
  licence: "snirh-terms",
  attribution: "SNIRH — Sistema Nacional de Informação de Recursos Hídricos, APA",
  topics: ["environment", "weather"],
  feeds: [
    reading("snirh-river-levels-feed", "river-level", SNIRH_HOURLY_POLICY),
    reading("snirh-river-flows-feed", "river-flow", SNIRH_DAILY_POLICY),
    reading("snirh-reservoir-storage-feed", "reservoir-volume", SNIRH_DAILY_POLICY),
    reading("snirh-reservoir-levels-feed", "reservoir-level", SNIRH_DAILY_POLICY),
    reading("snirh-precipitation-feed", "precipitation", SNIRH_HOURLY_POLICY),
    reading("snirh-air-temperature-feed", "air-temperature", SNIRH_HOURLY_POLICY),
    reading("snirh-relative-humidity-feed", "relative-humidity", SNIRH_HOURLY_POLICY),
    reading("snirh-wind-speed-feed", "wind-speed", SNIRH_HOURLY_POLICY),
    reading("snirh-groundwater-levels-feed", "groundwater-level", SNIRH_MONTHLY_POLICY),
  ],
};
