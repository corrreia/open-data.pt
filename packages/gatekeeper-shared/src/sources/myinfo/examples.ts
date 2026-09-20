import type { CollectionPolicyDefinition, ExampleFeed, ServingPolicyDefinition } from "../../index";

/**
 * No operator on this platform publishes reuse terms, and their pages carry no
 * licence, so the catalog says what it can stand behind: whatever terms the
 * operator holds its own data under are the terms it is served under. Carris
 * says the same, for the same reason. The attribution names the operator and
 * the portal it was read from, never this platform: the data is theirs.
 */
function serving(operator: string): ServingPolicyDefinition {
  return { licence: "source-terms", attribution: `${operator} via myinfo.4cloud.pt` };
}

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

const TOPICS = ["mobility"];

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
    title: `${from} to ${to} departures`,
    description: `Every scheduled Barraqueiro Oeste departure from ${from} to ${to}, with its arrival, journey time, lines and the days it runs.`,
    config: { source: "myinfo", feed: "timetable", operator: "BarraqueiroOeste", origin, destination },
    policy: { name: "MYINFO timetable", version: 1, collection: TIMETABLE, serving: serving("Barraqueiro Oeste") },
    staleAfterSeconds: 172_800,
    publisher: "barraqueiro-oeste",
    topics: TOPICS,
  };
}

export const MYINFO_EXAMPLES: ExampleFeed[] = [
  {
    slug: "barraqueiro-oeste-network-feed",
    title: "Barraqueiro Oeste stops and lines",
    description: "Every bus stop Barraqueiro Oeste serves in the Oeste region, with its position, and every line and direction it runs.",
    config: { source: "myinfo", feed: "network", operator: "BarraqueiroOeste" },
    policy: { name: "MYINFO network", version: 1, collection: NETWORK, serving: serving("Barraqueiro Oeste") },
    staleAfterSeconds: 172_800,
    publisher: "barraqueiro-oeste",
    topics: TOPICS,
  },
  {
    slug: "boa-viagem-network-feed",
    title: "Boa Viagem stops and lines",
    description: "Every bus stop Boa Viagem serves north of Lisbon, with its position, and every line and direction it runs.",
    config: { source: "myinfo", feed: "network", operator: "BoaViagem" },
    policy: { name: "MYINFO network", version: 1, collection: NETWORK, serving: serving("Boa Viagem") },
    staleAfterSeconds: 172_800,
    publisher: "boa-viagem",
    topics: TOPICS,
  },
  {
    slug: "ribatejana-network-feed",
    title: "Ribatejana stops and lines",
    description: "Every bus stop Ribatejana serves in the Ribatejo, with its position, and every line and direction it runs.",
    config: { source: "myinfo", feed: "network", operator: "Ribatejana" },
    policy: { name: "MYINFO network", version: 1, collection: NETWORK, serving: serving("Ribatejana") },
    staleAfterSeconds: 172_800,
    publisher: "ribatejana",
    topics: TOPICS,
  },
  {
    slug: "mare-network-feed",
    title: "Maré stops and lines",
    description: "Every bus stop Maré serves in Matosinhos, Maia, Valongo and Gondomar, with its position, and every line and direction it runs.",
    config: { source: "myinfo", feed: "network", operator: "mare" },
    policy: { name: "MYINFO network", version: 1, collection: NETWORK, serving: serving("Maré") },
    staleAfterSeconds: 172_800,
    publisher: "mare",
    topics: TOPICS,
  },
  {
    slug: "barraqueiro-oeste-torres-vedras-lisboa-feed",
    title: "Torres Vedras to Lisbon departures",
    description: "Every scheduled Barraqueiro Oeste departure from Torres Vedras to Lisbon, with its arrival, journey time, lines and the days it runs.",
    config: { source: "myinfo", feed: "timetable", operator: "BarraqueiroOeste", origin: "4384", destination: "4325" },
    policy: { name: "MYINFO timetable", version: 1, collection: TIMETABLE, serving: serving("Barraqueiro Oeste") },
    staleAfterSeconds: 172_800,
    publisher: "barraqueiro-oeste",
    topics: TOPICS,
  },
  {
    slug: "barraqueiro-oeste-lisboa-torres-vedras-feed",
    title: "Lisbon to Torres Vedras departures",
    description: "Every scheduled Barraqueiro Oeste departure from Lisbon to Torres Vedras, with its arrival, journey time, lines and the days it runs.",
    config: { source: "myinfo", feed: "timetable", operator: "BarraqueiroOeste", origin: "4325", destination: "4384" },
    policy: { name: "MYINFO timetable", version: 1, collection: TIMETABLE, serving: serving("Barraqueiro Oeste") },
    staleAfterSeconds: 172_800,
    publisher: "barraqueiro-oeste",
    topics: TOPICS,
  },
  {
    slug: "barraqueiro-oeste-torres-vedras-ericeira-feed",
    title: "Torres Vedras to Ericeira departures",
    description: "Every scheduled Barraqueiro Oeste departure from Torres Vedras to Ericeira, with its arrival, journey time, lines and the days it runs.",
    config: { source: "myinfo", feed: "timetable", operator: "BarraqueiroOeste", origin: "4384", destination: "16692" },
    policy: { name: "MYINFO timetable", version: 1, collection: TIMETABLE, serving: serving("Barraqueiro Oeste") },
    staleAfterSeconds: 172_800,
    publisher: "barraqueiro-oeste",
    topics: TOPICS,
  },
  {
    slug: "ribatejana-foros-salvaterra-marinhais-feed",
    title: "Foros de Salvaterra to Marinhais departures",
    description: "Every scheduled Ribatejana departure from Foros de Salvaterra to Marinhais, with its arrival, journey time, lines and the days it runs.",
    config: { source: "myinfo", feed: "timetable", operator: "Ribatejana", origin: "670", destination: "677" },
    policy: { name: "MYINFO timetable", version: 1, collection: TIMETABLE, serving: serving("Ribatejana") },
    staleAfterSeconds: 172_800,
    publisher: "ribatejana",
    topics: TOPICS,
  },
  ...TORRES_VEDRAS_ROUTES.flatMap(torresVedrasExample),
];
