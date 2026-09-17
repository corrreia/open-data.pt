/**
 * The catalog's topics: the vocabulary of tags a feed may carry, in any number
 * and any order, for browsing and filtering. They say nothing about where a
 * feed runs — a feed runs in the Worker of the library that reads it — and a
 * tag outside this list is a mistake a test catches.
 */
export const TOPICS = {
  cities: "Cities and municipalities",
  culture: "Culture and heritage",
  economy: "Economy and finance",
  energy: "Energy and electricity",
  environment: "Environment and nature",
  government: "Government and public administration",
  health: "Health services",
  mobility: "Mobility and transport",
  society: "Society, culture and territory",
  telecom: "Telecommunications and the internet",
  weather: "Weather and climate",
} as const;

export type Topic = keyof typeof TOPICS;

export function isTopic(value: string | undefined): value is Topic {
  return value !== undefined && Object.hasOwn(TOPICS, value);
}
