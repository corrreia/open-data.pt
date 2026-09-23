import { defineFeed } from "#/catalog/define";
import { UDATA_DEPLOYMENT, UDATA_NORMALIZER, UDATA_TRANSFORMER, collectUdataFeed } from "#/formats/udata/index";
import { MIB } from "#/formats/udata/feeds";

export const FEED = defineFeed(UDATA_DEPLOYMENT, {
  slug: "primary-care-oral-health-referrals-feed",
  config: {
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
  policy: {
    name: "Primary-care oral-health monthly series",
    version: 1,
    collection: { cadenceSeconds: 86_400, timeoutSeconds: 45, maxBytes: 8 * MIB, historyMode: "changes", maxOutputBytes: 64 * MIB },
  },
  staleAfterSeconds: 7 * 86_400,
  /** Once a day: DGS's monthly oral-health referrals CSV on dados.gov.pt, downloaded only when it has changed. */
  fetch: ({ config, state, library, fetch }) => collectUdataFeed(config, state, library.hosts, fetch),
  /** The CSV, read generically, into one record per month, area, sex and age group. */
  transform: { normalizer: UDATA_NORMALIZER, streaming: (body, context) => UDATA_TRANSFORMER.transform(body, context) },
});
