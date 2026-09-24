import type { PublisherDefinition } from "#/catalog/define";
import { FEED as municipalAccessibility } from "./feeds/municipal-accessibility";

export const PUBLISHER: PublisherDefinition = {
  name: "DEMARCA Design",
  sources: ["dados.gov.pt"],
  logo: "png",
  feeds: [municipalAccessibility],
};
