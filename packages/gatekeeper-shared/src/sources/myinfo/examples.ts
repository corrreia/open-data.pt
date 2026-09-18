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
];
