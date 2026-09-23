/**
 * The catalog's licences: the vocabulary of terms a product may be served
 * under, one key per set of terms, so the site can list them and group every
 * dataset by the terms it carries. A dataset names one by key; a key outside
 * this list is a mistake the type system catches.
 *
 * An entry is what the publisher states, never more: a licence with a
 * canonical text gets its URL; a publisher's own terms get their name and
 * page; and where nothing is stated, `source-terms` says so.
 */
import { UNSTATED_LICENCE } from "@open-data-pt/contract";

export interface LicenceDescription {
  /** Short enough for a badge. */
  name: string;
  /** The licence text or the publisher's terms page, when there is one. */
  url?: string;
  /** One sentence on what the terms allow, for the licence page. */
  summary: string;
}

export const LICENCES = {
  "cc-by-4.0": {
    name: "CC BY 4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
    summary: "Creative Commons Attribution 4.0 International: reuse, adapt and redistribute for any purpose, crediting the publisher.",
  },
  "cc-by": {
    name: "Creative Commons Attribution (CC BY)",
    summary: "Creative Commons Attribution, version not stated by the publisher: reuse for any purpose, crediting the publisher.",
  },
  "cc0-1.0": {
    name: "CC0 1.0",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    summary: "Creative Commons Zero: the publisher waives its rights, and the data may be used without attribution.",
  },
  "odc-pddl": {
    name: "ODC PDDL 1.0",
    url: "https://opendatacommons.org/licenses/pddl/1-0/",
    summary: "Open Data Commons Public Domain Dedication and Licence: the publisher places the data in the public domain, to be used for any purpose without attribution.",
  },
  "other-pd": {
    name: "Public domain (dados.gov.pt)",
    summary: "Listed on dados.gov.pt as public domain (other-pd); the publisher may state conditions of its own on the dataset page.",
  },
  "parlamento-dados-abertos": {
    name: "Assembleia da República open data terms",
    url: "https://www.parlamento.pt/Cidadania/Paginas/DadosAbertos.aspx",
    summary:
      "Os dados podem ser livremente reutilizados por qualquer instituição ou pessoa para a criação de novos conteúdos, devendo apenas ser mencionada a fonte (Assembleia da República).",
  },
  "bportugal-reuse": {
    name: "Banco de Portugal information reuse conditions",
    summary: "Banco de Portugal's own conditions for reusing BPstat information govern reuse.",
  },
  eurostat: {
    name: "Eurostat copyright and licence policy",
    url: "https://ec.europa.eu/eurostat/about-us/policies/copyright",
    summary: "Eurostat's data may be reused free of charge for commercial and non-commercial purposes, with the source acknowledged.",
  },
  "ren-datahub": {
    name: "REN Data Hub terms of use",
    summary: "REN publishes the Data Hub under its own terms of use, which govern reuse.",
  },
  "metrolisboa-api": {
    name: "Metropolitano de Lisboa API terms of use",
    summary: "Metropolitano de Lisboa serves its API under its own terms of use, which govern reuse of what it returns.",
  },
  "nasa-earthdata": {
    name: "NASA Earth Science full and open data policy",
    url: "https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-information-guidance",
    summary: "NASA commits to full, open and non-discriminatory sharing of its Earth science data; source acknowledgement remains requested.",
  },
  "sgifr-terms": {
    name: "SGIFR terms of use",
    url: "https://www.sgifr.gov.pt/termos-e-condicoes",
    summary: "SGIFR requires source attribution and excludes commercial reuse without prior permission: credit ANEPC, and ask them before putting this data to commercial use.",
  },
  "ipma-terms": {
    name: "IPMA conditions of use",
    url: "https://www.ipma.pt/pt/siteinfo/index.html?page=termos.xml",
    summary:
      "IPMA allows its information to be copied and used free of charge for personal or public purposes provided no profit-making purpose follows from that use, and asks that the source always be named.",
  },
  "snirh-terms": {
    name: "SNIRH terms of use",
    url: "https://snirh.apambiente.pt/index.php?idMain=5&idItem=5",
    summary: 'SNIRH permits use of its contents provided the source is named: "É permitido o uso dos conteúdos deste site, desde que mencionada a sua fonte."',
  },
  "dgeg-precos-terms": {
    name: "DGEG fuel price terms",
    url: "https://precoscombustiveis.dgeg.gov.pt/apresentacao/",
    summary: "DGEG offers the fuel prices free and for free use, and prohibits using them for commercial purposes.",
  },
  "usgs-public-domain": {
    name: "USGS public domain",
    url: "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits",
    summary: "USGS-authored data are generally in the U.S. public domain; USGS asks users to give proper source credit.",
  },
  "ioda-all-rights-reserved": {
    name: "IODA, all rights reserved",
    url: "https://api.ioda.inetintel.cc.gatech.edu/v2/datasources/",
    summary: "Georgia Tech Research Corporation reserves all rights; republication needs permission, which is why the source is held.",
  },
  "ripe-ncc-terms": {
    name: "RIPEstat Service Terms and Conditions",
    url: "https://www.ripe.net/about-us/legal/ripestat-service-terms-and-conditions",
    summary: "RIPEstat data may not be repackaged, compiled or redistributed without permission. RIPE NCC gave open-data.pt that permission on 21 September 2026.",
  },
  "peeringdb-aup": {
    name: "PeeringDB Acceptable Use Policy",
    url: "https://www.peeringdb.com/aup",
    summary: "PeeringDB requires permission for reproduction and bulk sharing outside its approved uses, which is why the source is held.",
  },
  [UNSTATED_LICENCE]: {
    name: "No licence stated",
    summary: "The publisher states no reuse licence. Check its site before you reuse the data: it is served here under whatever terms the publisher holds it.",
  },
} as const satisfies Record<string, LicenceDescription>;

export type Licence = keyof typeof LICENCES;

export function isLicence(value: string | undefined): value is Licence {
  return value !== undefined && Object.hasOwn(LICENCES, value);
}
