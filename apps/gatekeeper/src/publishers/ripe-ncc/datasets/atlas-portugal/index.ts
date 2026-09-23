import type { DatasetDefinition } from "#/catalog/define";

/*
 * RIPE Atlas data is not openly licensed, whatever "open data" articles about it
 * say. The RIPE NCC Terms of Service Article 3.5 read "The User shall not
 * re-package, download, compile, re-distribute or re-Use any or all of the data
 * contained on the Website or on any Publicly Available RIPE NCC Service, unless
 * this is permitted as part of their Use of the Website or the particular
 * Publicly Available RIPE NCC Service"; the RIPE Atlas Service Terms and
 * Conditions v3.5 Article 4.5 add that "Any commercial use of the RIPE Atlas
 * Data is subject to prior permission by the RIPE NCC", and Article 10.2 that
 * RIPE NCC databases "may only be used, reproduced and made available to third
 * parties upon prior written authorisation from the RIPE NCC". No Creative
 * Commons grant exists for probe metadata or measurement results. Do not
 * auto-install for public republication without that permission, exactly as for
 * RIPEstat.
 */
export const DATASET: DatasetDefinition = {
  title: "RIPE Atlas in Portugal",
  description: "The RIPE Atlas probes and anchors hosted in Portugal.",
  licence: "ripe-atlas-terms",
  attribution: "RIPE NCC, RIPE Atlas and its probe hosts",
  topics: ["telecom"],
};
