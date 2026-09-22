/** The Porto portal moved to dadosabertos.cm-porto.pt in September 2026; opendata.porto.digital no longer resolves. */
export const PORTO_HOST = "dadosabertos.cm-porto.pt";

/*
 * Porto's museums and thematic centres (cultura-cultura-museus) did not survive the
 * September 2026 move to dadosabertos.cm-porto.pt: the re-imported catalog of 69
 * datasets carries no museum inventory under any name. Restore the feed when the
 * municipality publishes one again.
 */

export const DAILY_REFERENCE = {
  name: "Porto CKAN daily reference snapshot",
  version: 1,
  collection: {
    cadenceSeconds: 86_400,
    timeoutSeconds: 60,
    maxBytes: 10 * 1024 * 1024,
    historyMode: "changes",
  },
} as const;
