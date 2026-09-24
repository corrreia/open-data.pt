import type { PublisherDefinition } from "#/catalog/define";
import { FEED as municipalEvCharging } from "./feeds/municipal-ev-charging";
import { FEED as recognisedStartups } from "./feeds/recognised-startups";

export const PUBLISHER: PublisherDefinition = {
  name: "ARTE · Agência para a Reforma Tecnológica do Estado",
  sources: ["dados.gov.pt"],
  logo: "svg",
  feeds: [municipalEvCharging, recognisedStartups],
};
