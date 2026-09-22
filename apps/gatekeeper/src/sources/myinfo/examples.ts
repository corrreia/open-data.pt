import type { CollectionPolicyDefinition, ExampleFeed } from "../../index";

/** A stop network changes when a stop moves or a line is redrawn: daily is often enough, and every change is worth keeping. */
const NETWORK: CollectionPolicyDefinition = {
  cadenceSeconds: 86_400,
  timeoutSeconds: 60,
  maxBytes: 4 * 1024 * 1024,
  historyMode: "changes",
};

/** A search answers for one day, so a daily collection sees every service pattern within a week. */
const TIMETABLE: CollectionPolicyDefinition = {
  cadenceSeconds: 86_400,
  timeoutSeconds: 60,
  maxBytes: 1024 * 1024,
  historyMode: "changes",
};

/**
 * Torres Vedras publishes nothing itself — its services portal is behind a
 * login and its geoportal proxies every layer from hosts inside the building —
 * so the concelho reaches this catalog through the operator that serves it.
 * These are the places Barraqueiro Oeste runs to from the town, as its own
 * search offers them: the beach, the western parishes and the neighbouring
 * concelhos. The long-distance pairs (Lisbon, Ericeira) are above.
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

function torresVedrasExample(route: TorresVedrasRoute): ExampleFeed[] {
  const legs: ExampleFeed[] = [timetable(`torres-vedras-${route.slug}`, "Torres Vedras", route.place, TORRES_VEDRAS, route.zone)];
  if (route.both) legs.push(timetable(`${route.slug}-torres-vedras`, route.place, "Torres Vedras", route.zone, TORRES_VEDRAS));
  return legs;
}

/** One Barraqueiro Oeste timetable, from one of its places to another. */
function timetable(slug: string, from: string, to: string, origin: string, destination: string): ExampleFeed {
  return {
    slug: `barraqueiro-oeste-${slug}-feed`,
    dataset: "barraqueiro-oeste",
    title: `${from} to ${to} departures`,
    description: `Every scheduled Barraqueiro Oeste departure from ${from} to ${to}, with its arrival, journey time, lines and the days it runs.`,
    config: { source: "myinfo", feed: "timetable", operator: "BarraqueiroOeste", origin, destination },
    policy: { name: "MYINFO timetable", version: 1, collection: TIMETABLE },
    staleAfterSeconds: 172_800,
  };
}

export const MYINFO_EXAMPLES: ExampleFeed[] = [
  {
    slug: "barraqueiro-oeste-network-feed",
    dataset: "barraqueiro-oeste",
    title: "Barraqueiro Oeste stops and lines",
    description: "Every bus stop Barraqueiro Oeste serves in the Oeste region, with its position, and every line and direction it runs.",
    config: { source: "myinfo", feed: "network", operator: "BarraqueiroOeste" },
    policy: { name: "MYINFO network", version: 1, collection: NETWORK },
    staleAfterSeconds: 172_800,
  },
  {
    slug: "boa-viagem-network-feed",
    dataset: "boa-viagem",
    config: { source: "myinfo", feed: "network", operator: "BoaViagem" },
    policy: { name: "MYINFO network", version: 1, collection: NETWORK },
    staleAfterSeconds: 172_800,
  },
  {
    slug: "ribatejana-network-feed",
    dataset: "ribatejana",
    title: "Ribatejana stops and lines",
    description: "Every bus stop Ribatejana serves in the Ribatejo, with its position, and every line and direction it runs.",
    config: { source: "myinfo", feed: "network", operator: "Ribatejana" },
    policy: { name: "MYINFO network", version: 1, collection: NETWORK },
    staleAfterSeconds: 172_800,
  },
  {
    slug: "mare-network-feed",
    dataset: "mare",
    config: { source: "myinfo", feed: "network", operator: "mare" },
    policy: { name: "MYINFO network", version: 1, collection: NETWORK },
    staleAfterSeconds: 172_800,
  },
  {
    slug: "barraqueiro-oeste-torres-vedras-lisboa-feed",
    dataset: "barraqueiro-oeste",
    title: "Torres Vedras to Lisbon departures",
    description: "Every scheduled Barraqueiro Oeste departure from Torres Vedras to Lisbon, with its arrival, journey time, lines and the days it runs.",
    config: { source: "myinfo", feed: "timetable", operator: "BarraqueiroOeste", origin: "4384", destination: "4325" },
    policy: { name: "MYINFO timetable", version: 1, collection: TIMETABLE },
    staleAfterSeconds: 172_800,
  },
  {
    slug: "barraqueiro-oeste-lisboa-torres-vedras-feed",
    dataset: "barraqueiro-oeste",
    title: "Lisbon to Torres Vedras departures",
    description: "Every scheduled Barraqueiro Oeste departure from Lisbon to Torres Vedras, with its arrival, journey time, lines and the days it runs.",
    config: { source: "myinfo", feed: "timetable", operator: "BarraqueiroOeste", origin: "4325", destination: "4384" },
    policy: { name: "MYINFO timetable", version: 1, collection: TIMETABLE },
    staleAfterSeconds: 172_800,
  },
  {
    slug: "barraqueiro-oeste-torres-vedras-ericeira-feed",
    dataset: "barraqueiro-oeste",
    title: "Torres Vedras to Ericeira departures",
    description: "Every scheduled Barraqueiro Oeste departure from Torres Vedras to Ericeira, with its arrival, journey time, lines and the days it runs.",
    config: { source: "myinfo", feed: "timetable", operator: "BarraqueiroOeste", origin: "4384", destination: "16692" },
    policy: { name: "MYINFO timetable", version: 1, collection: TIMETABLE },
    staleAfterSeconds: 172_800,
  },
  {
    slug: "ribatejana-foros-salvaterra-marinhais-feed",
    dataset: "ribatejana",
    title: "Foros de Salvaterra to Marinhais departures",
    description: "Every scheduled Ribatejana departure from Foros de Salvaterra to Marinhais, with its arrival, journey time, lines and the days it runs.",
    config: { source: "myinfo", feed: "timetable", operator: "Ribatejana", origin: "670", destination: "677" },
    policy: { name: "MYINFO timetable", version: 1, collection: TIMETABLE },
    staleAfterSeconds: 172_800,
  },
  ...TORRES_VEDRAS_ROUTES.flatMap(torresVedrasExample),
];
