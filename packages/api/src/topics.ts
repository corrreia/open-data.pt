/**
 * What each catalog topic is called on the site, in each of its languages. A
 * feed's topics are keys of the Gatekeeper's `TOPICS`; a test holds every one
 * of those to a name here.
 */
export const TOPIC_NAMES = {
  cities: { en: "Cities", pt: "Cidades" },
  culture: { en: "Culture", pt: "Cultura" },
  economy: { en: "Economy", pt: "Economia" },
  energy: { en: "Energy", pt: "Energia" },
  environment: { en: "Environment", pt: "Ambiente" },
  government: { en: "Government", pt: "Governo" },
  health: { en: "Health", pt: "Saúde" },
  mobility: { en: "Mobility", pt: "Mobilidade" },
  society: { en: "Society", pt: "Sociedade" },
  telecom: { en: "Telecom", pt: "Telecomunicações" },
  weather: { en: "Weather", pt: "Meteorologia" },
} as const satisfies { [topic: string]: { en: string; pt: string } };

type NamedTopic = keyof typeof TOPIC_NAMES;

const isNamed = (topic: string): topic is NamedTopic => Object.hasOwn(TOPIC_NAMES, topic);

/** A topic's name in a language; a key with no name yet reads as itself, capitalised. */
export function topicName(topic: string, language: "en" | "pt"): string {
  if (isNamed(topic)) return TOPIC_NAMES[topic][language];
  return topic.charAt(0).toLocaleUpperCase() + topic.slice(1).replaceAll("-", " ");
}
