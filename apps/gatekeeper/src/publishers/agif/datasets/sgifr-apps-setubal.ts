import type { DatasetDefinition } from "../../../catalog/define";
import { appsFeed } from "../wfs";

export const DATASET: DatasetDefinition = {
  title: "Fire-prevention priority areas in Setúbal",
  description:
    "Every Áreas Prioritárias de Prevenção e Segurança (APPS) parcel in the district of Setúbal, as approved in the sub-regional action programmes: its municipality, NUTS regions, danger class, type and origin, the plan that approved it, its area in hectares, and whether the burning and land-clearing restrictions of Article 60 and of each paragraph of Article 68 apply to it. Collected without outlines: the national layer's boundaries run to about 250 MB, and these attributes are what can be read and compared.",
  licence: "sgifr-terms",
  attribution: "AGIF and ANEPC through SGIFR — Sistema de Gestão Integrada de Fogos Rurais (https://www.sgifr.gov.pt)",
  topics: ["environment", "society"],
  feeds: [appsFeed({ slug: "sgifr-apps-setubal-feed", district: "Setúbal" })],
};
