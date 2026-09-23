import type { CollectionPolicyDefinition } from "#/index";

/** Águeda's CKAN portal. */
export const AGUEDA_HOST = "dadosabertos.cm-agueda.pt";

/** A slowly changing municipal location inventory, read monthly, with no live availability claim. */
export const AGUEDA_MONTHLY: CollectionPolicyDefinition = { cadenceSeconds: 30 * 86_400, timeoutSeconds: 90, maxBytes: 4 * 1024 * 1024, historyMode: "changes" };
