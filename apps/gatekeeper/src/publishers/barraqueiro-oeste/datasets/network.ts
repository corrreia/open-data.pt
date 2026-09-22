import type { DatasetDefinition } from "#/catalog/define";
import type { FeedDefinition } from "#/catalog/define";
import { MYINFO_NETWORK_POLICY, MYINFO_TIMETABLE_POLICY } from "#/formats/myinfo/feeds";

const LISBOA = "4325";

/**
 * Torres Vedras publishes nothing itself — its services portal is behind a
 * login and its geoportal proxies every layer from hosts inside the building —
 * so the concelho reaches this catalog through the operator that serves it.
 * These are the places Barraqueiro Oeste runs to from the town, as its own
 * search offers them: the beach, the western parishes and the neighbouring
 * concelhos. The long-distance pairs (Lisbon, Ericeira) are listed first.
 */
const TORRES_VEDRAS = "4384";

interface TorresVedrasRoute {
  slug: string;
  place: string;
  zone: string;
  /** Set when the return leg is worth its own feed rather than only the outbound one. */
  both?: true;
}

const TORRES_VEDRAS_ROUTES: TorresVedrasRoute[] = [
  { slug: "praia-de-santa-cruz", place: "Praia de Santa Cruz", zone: "4364", both: true },
  { slug: "lourinha", place: "Lourinhã", zone: "4329", both: true },
  { slug: "silveira", place: "Silveira", zone: "4377" },
  { slug: "a-dos-cunhados", place: "A dos Cunhados", zone: "4263" },
  { slug: "campelos", place: "Campelos", zone: "4422" },
  { slug: "turcifal", place: "Turcifal", zone: "4385" },
  // Maxial, Dois Portos and Runa are offered by the search but answer it with no trips:
  // the operator reaches them, but not on a service that starts in Torres Vedras.
];

function torresVedrasFeeds(route: TorresVedrasRoute): FeedDefinition[] {
  const legs: FeedDefinition[] = [timetable(`torres-vedras-${route.slug}`, "Torres Vedras", route.place, TORRES_VEDRAS, route.zone)];
  if (route.both) legs.push(timetable(`${route.slug}-torres-vedras`, route.place, "Torres Vedras", route.zone, TORRES_VEDRAS));
  return legs;
}

/** One Barraqueiro Oeste timetable, from one of its places to another. */
function timetable(slug: string, from: string, to: string, origin: string, destination: string): FeedDefinition {
  return {
    slug: `barraqueiro-oeste-${slug}-feed`,
    title: `${from} to ${to} departures`,
    description: `Every scheduled Barraqueiro Oeste departure from ${from} to ${to}, with its arrival, journey time, lines and the days it runs.`,
    config: { source: "myinfo", feed: "timetable", operator: "BarraqueiroOeste", origin, destination },
    policy: MYINFO_TIMETABLE_POLICY,
    staleAfterSeconds: 172_800,
  };
}

export const DATASET: DatasetDefinition = {
  title: "Barraqueiro Oeste stops and lines",
  description: "Every bus stop Barraqueiro Oeste serves in the Oeste region, with its position, and every line and direction it runs.",
  licence: "source-terms",
  attribution: "Barraqueiro Oeste via myinfo.4cloud.pt",
  topics: ["mobility"],
  feeds: [
    {
      slug: "barraqueiro-oeste-network-feed",
      title: "Barraqueiro Oeste stops and lines",
      description: "Every bus stop Barraqueiro Oeste serves in the Oeste region, with its position, and every line and direction it runs.",
      config: { source: "myinfo", feed: "network", operator: "BarraqueiroOeste" },
      policy: MYINFO_NETWORK_POLICY,
      staleAfterSeconds: 172_800,
    },
    timetable("torres-vedras-lisboa", "Torres Vedras", "Lisbon", TORRES_VEDRAS, LISBOA),
    timetable("lisboa-torres-vedras", "Lisbon", "Torres Vedras", LISBOA, TORRES_VEDRAS),
    timetable("torres-vedras-ericeira", "Torres Vedras", "Ericeira", TORRES_VEDRAS, "16692"),
    ...TORRES_VEDRAS_ROUTES.flatMap(torresVedrasFeeds),
  ],
};
