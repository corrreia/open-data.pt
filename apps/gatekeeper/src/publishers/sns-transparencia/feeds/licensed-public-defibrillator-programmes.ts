import { defineFeed } from "#/catalog/define";
import { SNS_HOST, SNS_MONTHLY_PERIODS } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-licensed-public-defibrillator-programmes-feed",
  title: "Licensed public-space defibrillator programmes",
  description:
    "The complete published register of public-space defibrillator programmes, with establishment, address and reporting month. The portal's numeric record field is an identifier, not a count or a live AED availability measurement.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  config: {
    host: SNS_HOST,
    limit: "10000",
    dataset: "evolucao-programas-dae-licenciados-em-espacos-publicos",
    timeField: "tempo",
    orderBy: "tempo DESC,n_o_registos",
    idFields: "n_o_registos",
  },
  policy: SNS_MONTHLY_PERIODS,
  staleAfterSeconds: 5_184_000,
  /** Once a month: the latest reporting periods of SNS Transparência's `evolucao-programas-dae-licenciados-em-espacos-publicos` dataset, by `tempo`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `evolucao-programas-dae-licenciados-em-espacos-publicos` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into a table. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
