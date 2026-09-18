/**
 * The catalog's licences: the vocabulary of terms a product may be served
 * under, one key per set of terms, so the site can list them and group every
 * dataset by the terms it carries. A policy names one by key; a key outside
 * this list is a mistake the type system and a test catch.
 *
 * An entry is what the publisher states, never more: a licence with a
 * canonical text gets its URL; a publisher's own terms get their name and
 * page; and where nothing is stated, `source-terms` says so.
 */
export interface LicenceDescription {
  /** Short enough for a badge. */
  name: string;
  /** The licence text or the publisher's terms page, when there is one. */
  url?: string;
  /** One sentence on what the terms allow, for the licence page. */
  summary: string;
}

/** The key a policy carries when the publisher states no reuse terms: not a licence, so no markup names one. */
export const UNSTATED_LICENCE = "source-terms";

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
    summary: "SGIFR requires source attribution and excludes commercial reuse without prior permission, which is why ANEPC publication is held.",
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
    summary: "RIPEstat data may not be repackaged, compiled or redistributed without permission, which is why the source is held.",
  },
  "ripe-atlas-terms": {
    name: "RIPE Atlas Service Terms and Conditions",
    url: "https://www.ripe.net/about-us/legal/ripe-atlas-service-terms-and-conditions/",
    summary: "RIPE Atlas data may not be repackaged or redistributed without permission, which is why the source is held.",
  },
  "peeringdb-aup": {
    name: "PeeringDB Acceptable Use Policy",
    url: "https://www.peeringdb.com/aup",
    summary: "PeeringDB requires permission for reproduction and bulk sharing outside its approved uses, which is why the source is held.",
  },
  [UNSTATED_LICENCE]: {
    name: "Source terms apply",
    summary: "The publisher states no reuse licence: whatever terms it holds its own data under are the terms it is served under here.",
  },
} as const satisfies Record<string, LicenceDescription>;

export type Licence = keyof typeof LICENCES;

export function isLicence(value: string | undefined): value is Licence {
  return value !== undefined && Object.hasOwn(LICENCES, value);
}
