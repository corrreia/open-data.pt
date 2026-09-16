/**
 * The catalog's topics. Each is one Gatekeeper Worker, and a feed runs in the
 * Worker of its first topic: `pnpm packages:sync` generates a Worker for every
 * topic a feed names first, with the libraries those feeds use.
 */
export const TOPICS = {
  cities: "Cities and municipalities",
  economy: "Economy and finance",
  energy: "Energy and electricity",
  environment: "Environment and weather",
  government: "Government and public administration",
  health: "Health services",
  mobility: "Mobility and transport",
  society: "Society, culture and territory",
  telecom: "Telecommunications and the internet",
} as const;

export type Topic = keyof typeof TOPICS;

export function isTopic(value: string | undefined): value is Topic {
  return value !== undefined && Object.hasOwn(TOPICS, value);
}
