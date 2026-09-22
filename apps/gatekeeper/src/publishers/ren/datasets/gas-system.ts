import type { DatasetDefinition } from "../../../catalog/define";
import { renChartFeed } from "../ren/feeds";

/** The gas charts gain one point an hour. */
const GAS_POLICY = {
  name: "REN gas hourly chart data",
  version: 1,
  collection: {
    cadenceSeconds: 3_600,
    timeoutSeconds: 30,
    maxBytes: 2 * 1024 * 1024,
    historyMode: "changes",
  },
} as const;

export const DATASET: DatasetDefinition = {
  title: "REN natural gas system",
  description: "Portugal's natural gas: what is consumed, how the network balances, what the LNG terminal handles and what is held underground.",
  licence: "ren-datahub",
  attribution: "REN — Redes Energéticas Nacionais",
  topics: ["energy"],
  feeds: [
    renChartFeed("gas-consumption", GAS_POLICY, "REN natural gas consumption", "Hourly natural gas consumption by major customer group."),
    renChartFeed("gas-network-balance", GAS_POLICY, "REN natural gas network balance", "Hourly inputs and outputs for Portugal's high-pressure natural gas network."),
    {
      slug: "ren-lng-terminal-balance-feed",
      title: "REN LNG terminal daily balance",
      description:
        "Total inputs, outputs, stored energy and fullness at Portugal's LNG terminal for the latest seven completed calendar days available. Daily reports may be published with a lag; missing reports are not zero.",
      config: { source: "ren", service: "lng-terminal-balance" },
      policy: {
        name: "REN daily storage balance",
        version: 2,
        collection: { cadenceSeconds: 86_400, timeoutSeconds: 120, maxBytes: 512 * 1024, historyMode: "changes" },
      },
      staleAfterSeconds: 3 * 86_400,
    },
    {
      slug: "ren-gas-storage-feed",
      title: "REN underground natural gas storage",
      description:
        "Total injections, withdrawals, stored energy and fullness at underground gas storage for the latest seven completed calendar days available. Daily reports may be published with a lag; missing reports are not zero.",
      config: { source: "ren", service: "gas-storage" },
      policy: {
        name: "REN daily storage balance",
        version: 2,
        collection: { cadenceSeconds: 86_400, timeoutSeconds: 120, maxBytes: 512 * 1024, historyMode: "changes" },
      },
      staleAfterSeconds: 3 * 86_400,
    },
  ],
};
