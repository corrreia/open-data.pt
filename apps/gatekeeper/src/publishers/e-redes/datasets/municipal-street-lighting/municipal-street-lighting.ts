import { defineFeed } from "#/catalog/define";
import { E_REDES_HOST, E_REDES_MONTHLY_PERIODS } from "#/publishers/e-redes/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "e-redes-municipal-street-lighting-feed",
  config: {
    host: E_REDES_HOST,
    limit: "10000",
    dataset: "cadastro_iluminacao_publica",
    timeField: "ano",
    monthField: "mes",
    select: "ano,mes,coddistritoconcelho,tipo_de_lampada,sum(luminarias) as luminarias,sum(lampadas) as lampadas,sum(potencia_instalada_total) as potencia_instalada_total",
    groupBy: "ano,mes,coddistritoconcelho,tipo_de_lampada",
    orderBy: "ano DESC,mes DESC,coddistritoconcelho,tipo_de_lampada",
    dimensions: "coddistritoconcelho,tipo_de_lampada",
    series: "luminarias,lampadas,potencia_instalada_total",
    units: "luminarias=luminaires,lampadas=lamps,potencia_instalada_total=W",
  },
  policy: E_REDES_MONTHLY_PERIODS,
  staleAfterSeconds: 5_184_000,
  /** Once a month: the latest reporting periods of E-REDES's `cadastro_iluminacao_publica` dataset, by `ano`, aggregated at the source. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** The portal's metadata and records, into series of its 3 measures. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
