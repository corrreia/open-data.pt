import type { CollectionPolicyDefinition, ExampleFeed, ServingPolicyDefinition } from "../../index";

const MEBIBYTE = 1024 * 1024;
const DGT_HOST = "ogcapi.dgterritorio.gov.pt";

const WEEK = 604_800;

/** The CAOP is republished as a dated edition, not continuously; weekly is frequent enough to catch a correction. */
const DGT_SERVING: ServingPolicyDefinition = {
  // DGT publishes no reuse licence with these collections: the service links
  // only its SNIG catalogue record. Nothing here may be invented.
  licence: "source-terms",
  attribution: "Direção-Geral do Território — Carta Administrativa Oficial de Portugal (CAOP) 2025",
};

/** Attribute tables: a few hundred kilobytes at most, every property on every feature. */
function attributePolicy(name: string, serving: ServingPolicyDefinition, maxBytes: number): ExampleFeed["policy"] {
  return {
    name,
    version: 3,
    collection: {
      cadenceSeconds: WEEK,
      timeoutSeconds: 120,
      maxBytes,
      historyMode: "changes",
    } satisfies CollectionPolicyDefinition,
    serving,
  };
}

export const OGC_EXAMPLES: ExampleFeed[] = [
  /*
   * DGT publishes the CAOP for Portugal Continental only: 18 districts, 278
   * municipalities and 3,049 parishes, with the Azores and Madeira absent from
   * these collections. Every title and description says so.
   *
   * They are collected without geometry. One district outline reaches 3.6 MB
   * and two municipal outlines pass 1 MB, which is the largest record the
   * platform stores; the whole municipal layer is 49 MB of coordinates that
   * would be re-read and re-compared on every collection. `skipGeometry` is a
   * documented OGC API Features parameter, the product page says the feed asks
   * for attributes only, and every feature is still published: the scope is
   * complete, only the shape is left at the source.
   */
  {
    slug: "dgt-caop-distritos-feed",
    title: "Mainland Portugal district reference table (CAOP 2025)",
    description:
      "The 18 districts of mainland Portugal in the official administrative charter: code, name, NUTS 1 region, area, perimeter, and how many municipalities and parishes each holds. Attributes only, without boundary outlines. The Azores and Madeira are not part of this collection.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "distritos",
      geometry: "skip",
      pageSize: "1000",
      maxPages: "5",
    },
    policy: attributePolicy("OGC weekly attribute table", DGT_SERVING, 4 * MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "dgt",
    topics: ["society"],
  },
  {
    slug: "dgt-caop-municipios-feed",
    title: "Mainland Portugal municipality reference table (CAOP 2025)",
    description:
      "The 278 municipalities of mainland Portugal in the official administrative charter: DTMN code, name, district, the three NUTS levels, area, perimeter, and parish count. Attributes only, without boundary outlines. The Azores and Madeira are not part of this collection.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "municipios",
      geometry: "skip",
      pageSize: "1000",
      maxPages: "5",
    },
    policy: attributePolicy("OGC weekly attribute table", DGT_SERVING, 4 * MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "dgt",
    topics: ["society"],
  },
  {
    slug: "dgt-caop-freguesias-feed",
    title: "Mainland Portugal parish reference table (CAOP 2025)",
    description:
      "The 3,049 civil parishes of mainland Portugal in the official administrative charter: DTMNFR code, name, municipality, district, the three NUTS levels, area and perimeter. Attributes only, without boundary outlines. The Azores and Madeira are not part of this collection.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "freguesias",
      geometry: "skip",
      pageSize: "1000",
      maxPages: "5",
    },
    policy: attributePolicy("OGC weekly attribute table", DGT_SERVING, 8 * MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "dgt",
    topics: ["society"],
  },

  /*
   * The eight Azores collections that lived here were removed in September 2026.
   * ambiente.azores.gov.pt sits behind a Cloudflare managed challenge that answers
   * our Workers with 403 and `cf-mitigated: challenge` on every request, whatever
   * user agent they send, so not one of those feeds ever collected. A publication
   * hold is per library and would have taken the DGT feeds down with them, so the
   * examples go instead and the Registry retires the eight feeds. Restoring them
   * needs the regional government to let our traffic through — a WAF skip rule for
   * the IDEA API paths, or a documented token — after which these entries come back
   * against host `ambiente.azores.gov.pt`, base path `idea-api`, collections Farois,
   * Operadores_GestaoResiduos, RedeMonitorizacao_QualidadeAr, Rede_Hidrometeorologica,
   * Lagoas, Zonas_EspeciaisConservacao, Geositios and Parques_NaturaisIlha, under
   * CC BY 4.0 with the same slugs, which their history depends on:
   * azores-farois-feed, azores-operadores-residuos-feed, azores-estacoes-qualidade-ar-feed,
   * azores-rede-hidrometeorologica-feed, azores-lagoas-feed,
   * azores-zonas-especiais-conservacao-feed, azores-geossitios-feed and
   * azores-parques-naturais-feed.
   */
];
