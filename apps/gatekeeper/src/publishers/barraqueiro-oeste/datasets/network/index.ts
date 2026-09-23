import type { DatasetDefinition } from "#/catalog/define";

/*
 * Torres Vedras publishes nothing itself — its services portal is behind a
 * login and its geoportal proxies every layer from hosts inside the building —
 * so the concelho reaches this catalog through the operator that serves it.
 * Beside the network, a timetable feed for each place Barraqueiro Oeste runs to
 * from the town, as its own search offers them: the beach, the western parishes
 * and the neighbouring concelhos, and the long-distance pairs to Lisbon and
 * Ericeira. Maxial, Dois Portos and Runa are offered by the search but answer it
 * with no trips: the operator reaches them, but not on a service that starts in
 * Torres Vedras. Zones in their configurations are the search's own codes:
 * Torres Vedras 4384, Lisboa 4325.
 */
export const DATASET: DatasetDefinition = {
  title: "Barraqueiro Oeste stops and lines",
  description: "Every bus stop Barraqueiro Oeste serves in the Oeste region, with its position, and every line and direction it runs.",
  licence: "source-terms",
  attribution: "Barraqueiro Oeste via myinfo.4cloud.pt",
  topics: ["mobility"],
};
