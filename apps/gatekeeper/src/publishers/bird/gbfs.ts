import { REALTIME_POLICY } from "#/formats/gbfs/feeds";

// Bird advertises a 60-second TTL; a five-minute public snapshot avoids
// hammering the operator while retaining useful municipal fleet counts.
export const BIRD_POLICY = {
  ...REALTIME_POLICY,
  name: "GBFS Bird snapshots, five minutes",
  collection: { ...REALTIME_POLICY.collection, cadenceSeconds: 300 },
} as const;
