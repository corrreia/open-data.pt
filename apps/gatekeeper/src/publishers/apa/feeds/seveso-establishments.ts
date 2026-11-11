import { defineFeed } from "#/catalog/define";
import { ARCGIS_DEPLOYMENT, ARCGIS_NORMALIZER, ARCGIS_TRANSFORMER, collectArcgisFeed } from "#/formats/arcgis/index";
import { APA_POLICY } from "#/publishers/apa/arcgis";

export const FEED = defineFeed(ARCGIS_DEPLOYMENT, {
  slug: "apa-seveso-establishments-feed",
  title: "Establishments under major-accident prevention rules",
  description: "Industrial sites covered by the Seveso major-accident prevention regime (Decree-Law 150/2015).",
  licence: "cc-by-4.0",
  attribution: "Agência Portuguesa do Ambiente — SNIAmb",
  topics: ["environment"],
  config: {
    host: "inspire.apambiente.pt",
    service: "arcgis/rest/services/INSPIRE/PF_Prevencao_Acidentes_Graves/MapServer",
    layer: "0",
  },
  policy: APA_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: APA's INSPIRE major-accident prevention layer, its metadata and every feature page. */
  fetch: ({ config, validator, library, fetch }) => collectArcgisFeed(config, validator, library.hosts, fetch),
  /** The layer's GeoJSON pages, streamed, into one record per feature with the layer's own schema. */
  transform: { normalizer: ARCGIS_NORMALIZER, streaming: (body, context) => ARCGIS_TRANSFORMER.transform(body, context) },
});
