import { defineFeed } from "#/catalog/define";
import { WFS_DEPLOYMENT, WFS_NORMALIZER, WFS_TRANSFORMER, collectWfsFeed } from "#/formats/wfs/index";
import { runTransformer } from "#/index";
import { DGT_MONTHLY_POLICY } from "#/publishers/dgt/wfs";

export const FEED = defineFeed(WFS_DEPLOYMENT, {
  slug: "dgt-serras-principais-feed",
  title: "Portugal's principal mountain ranges",
  description:
    "The 588 principal mountain ranges of Portugal as DGT delimits them, each with the name it goes by, its alignment, its highest and mean altitude, its height above the land around it, its length, width, area and perimeter, the rock that dominates it, the morphostructural and geomorphological units it belongs to, and how it rates for size and altimetric vigour. Attributes only: the 588 outlines come to eleven megabytes, more than one read of this service may carry.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Contributos para a delimitação das serras de Portugal",
  topics: ["culture", "environment"],
  config: {
    feed: "reference",
    host: "geo2.dgterritorio.gov.pt",
    path: "/geoserver/serras_contributos/wfs",
    typeName: "serras_contributos:Serras_principais",
    idField: "@id",
    srsName: "EPSG:4326",
    numberFields: "Alt_max,Alt_media,Altura,Compto_km,Area_km2,Perimet_km,Largura_m",
    // The service also holds a ruggedness rating, in a column whose name carries
    // an accent; a property list is ASCII, so naming the rest leaves that one behind.
    propertyNames: "Serra,_Nome,_OutroNome,Alinhament,Maiores,Alt_max,Alt_media,Altura,Compto_km,Largura_m,Area_km2,Perimet_km,RochaDomin,UnidadeME,GU,Grandeza,VigorAltim",
  },
  // A gazetteer, revised when the study behind it is: monthly is generous.
  policy: DGT_MONTHLY_POLICY,
  staleAfterSeconds: 5_184_000,
  /** Once a month: every feature of serras_contributos:Serras_principais on geo2.dgterritorio.gov.pt, page by page, as GeoJSON. */
  fetch: ({ config, validator, library, fetch, now }) => collectWfsFeed(config, validator, library.hosts, fetch, now()),
  /** The feature collection into one record per feature. */
  transform: { normalizer: WFS_NORMALIZER, buffered: (bytes, context) => runTransformer(WFS_TRANSFORMER, bytes, context) },
});
