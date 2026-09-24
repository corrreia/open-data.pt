import type { PublisherDefinition } from "#/catalog/define";
import { FEED as baseContractModifications2026 } from "./feeds/base-contract-modifications-2026";
import { FEED as baseProcurementEntities } from "./feeds/base-procurement-entities";
import { FEED as baseProcurementNotices2026 } from "./feeds/base-procurement-notices-2026";

export const PUBLISHER: PublisherDefinition = {
  name: "IMPIC · Instituto dos Mercados Públicos, do Imobiliário e da Construção",
  url: "https://www.impic.pt/",
  sources: ["dados.gov.pt"],
  logo: "png",
  feeds: [baseContractModifications2026, baseProcurementEntities, baseProcurementNotices2026],
};
