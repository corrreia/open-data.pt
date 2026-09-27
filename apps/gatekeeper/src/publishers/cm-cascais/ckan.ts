/** Cascais's CKAN portal, where every GeoCascais layer is exported nightly. */
export const CASCAIS_HOST = "dadosabertos.cascais.pt";

export const CASCAIS_DAILY_REFERENCE = {
  cadenceSeconds: 86_400,
  timeoutSeconds: 60,
  maxBytes: 10 * 1024 * 1024,
  historyMode: "changes",
} as const;
