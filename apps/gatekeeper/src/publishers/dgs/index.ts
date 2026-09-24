import type { PublisherDefinition } from "#/catalog/define";
import { FEED as primaryCareOralHealthReferrals } from "./feeds/primary-care-oral-health-referrals";

export const PUBLISHER: PublisherDefinition = {
  name: "DGS · Direção-Geral da Saúde",
  url: "https://www.dgs.pt/",
  sources: ["dados.gov.pt"],
  logo: "png",
  feeds: [primaryCareOralHealthReferrals],
};
