import type { DatasetDefinition } from "#/catalog/define";
import { SNIRH_MONTHLY_POLICY } from "#/publishers/apa/snirh/feeds";

export const DATASET: DatasetDefinition = {
  title: "SNIRH monthly bulletins",
  description: "The monthly bulletins APA works out from its network: precipitation, reservoir storage by river basin, and the state of each aquifer.",
  licence: "snirh-terms",
  attribution: "SNIRH — Sistema Nacional de Informação de Recursos Hídricos, APA",
  topics: ["environment", "weather"],
  feeds: [
    {
      slug: "snirh-monthly-precipitation-feed",
      title: "Portugal monthly precipitation",
      description:
        "Each finished month's precipitation at the stations of SNIRH's precipitation bulletin, with the station's monthly normal as a dimension. A month is published once it has ended.",
      config: { source: "snirh", feed: "monthly-precipitation" },
      policy: SNIRH_MONTHLY_POLICY,
      staleAfterSeconds: 259_200,
    },
    {
      slug: "snirh-reservoir-basins-feed",
      title: "Portugal reservoir storage by river basin",
      description:
        "Water stored at the end of each month in the reservoirs of SNIRH's storage bulletin, per river basin, as a share of their total capacity. Each point is dated by the first day of its month.",
      config: { source: "snirh", feed: "reservoir-basins" },
      policy: SNIRH_MONTHLY_POLICY,
      staleAfterSeconds: 259_200,
    },
    {
      slug: "snirh-groundwater-state-feed",
      title: "Portugal groundwater state by aquifer",
      description:
        "Each month's groundwater class for the aquifers of SNIRH's groundwater bulletin: whether their wells stood above the monthly mean, between the mean and the 20th percentile, or below it.",
      config: { source: "snirh", feed: "groundwater-state" },
      policy: SNIRH_MONTHLY_POLICY,
      staleAfterSeconds: 259_200,
    },
  ],
};
