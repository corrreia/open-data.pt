import type { PublisherDefinition } from "#/catalog/define";
import { FEED as activeOccurrences } from "./feeds/active-occurrences";

export const PUBLISHER: PublisherDefinition = {
  name: "ANEPC · Autoridade Nacional de Emergência e Proteção Civil",
  url: "https://prociv.gov.pt/",
  sources: ["api.sgifr.gov.pt"],
  logo: "png",
  feeds: [activeOccurrences],
};
