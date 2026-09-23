/** The line, route and stop catalogs change when the network is redrawn: daily is often enough, and every change is worth keeping. */
export const CARRIS_REFERENCE_POLICY = {
  name: "Carris reference data",
  version: 1,
  collection: {
    cadenceSeconds: 86_400,
    timeoutSeconds: 30,
    maxBytes: 12 * 1024 * 1024,
    historyMode: "changes",
  },
} as const;
