import type { DatasetDefinition, FeedDefinition } from "../../../catalog/define";
import { MIB, annualPolicy } from "../../../formats/udata/feeds";

/** A policy whose normalized output may exceed the kernel's 16 MiB default cap. */
function withOutputCap(policy: FeedDefinition["policy"], maxOutputBytes: number): FeedDefinition["policy"] {
  return { ...policy, collection: { ...policy.collection, maxOutputBytes } };
}

export const DATASET: DatasetDefinition = {
  title: "Primary-care oral-health referrals",
  description: "Monthly oral-health referrals by sex, age group, and primary-care area, published by the Portuguese health authority.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral da Saúde",
  topics: ["health"],
  feeds: [
    {
      slug: "primary-care-oral-health-referrals-feed",
      config: {
        source: "udata",
        baseUrl: "https://dados.gov.pt",
        dataset: "evolucao-mensal-das-referenciacoes-emitidas-de-saude-oral-nos-cuidados-de-saude-primarios-socsp-nos-centros-de-saude-agregado-por-aces",
        distributionId: "854aabb7-71ae-42ee-b9d5-4bc70b98d385",
        format: "csv",
        productSlug: "primary-care-oral-health-referrals",
        productTitle: "Primary-care oral-health referrals",
        productDescription: "Monthly issued oral-health referrals by sex, age group, ULS, and primary-care area.",
        keyField: "ID",
        eventTimeField: "Período",
        feed: "distribution",
        transformer: "tabular",
      },
      // About 45,000 rows: the 5.7 MB CSV can normalize to more than the 16 MiB default output cap.
      policy: withOutputCap(annualPolicy("Primary-care oral-health monthly series", 8 * MIB), 64 * MIB),
      staleAfterSeconds: 7 * 86_400,
    },
  ],
};
