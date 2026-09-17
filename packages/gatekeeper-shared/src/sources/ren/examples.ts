import type { ExampleFeed } from "../../index";
import type { RenServiceName } from "./ren";

const SERVING = {
  licence: "REN Data Hub terms of use",
  attribution: "REN — Redes Energéticas Nacionais",
} as const;

/** REN completes an electricity quarter-hour only twice an hour, so a faster cadence can never see a new point. */
const ELECTRICITY_POLICY = {
  name: "REN intraday chart data",
  version: 3,
  collection: {
    cadenceSeconds: 1_800,
    timeoutSeconds: 30,
    maxBytes: 2 * 1024 * 1024,
    historyMode: "changes",
  },
  serving: SERVING,
} as const;

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
  serving: SERVING,
} as const;

function example(service: RenServiceName, policy: ExampleFeed["policy"], title: string, description: string): ExampleFeed {
  return {
    slug: `ren-${service}-feed`,
    title,
    description,
    config: { source: "ren", service },
    policy,
    staleAfterSeconds: 3600,
    publisher: "REN · Redes Energéticas Nacionais",
    topics: ["energy"],
  };
}

export const REN_EXAMPLES: ExampleFeed[] = [
  example(
    "production-breakdown",
    ELECTRICITY_POLICY,
    "REN electricity production breakdown",
    "Quarter-hour electricity consumption, generation by source, storage, and import balance.",
  ),
  // The consumption service reads the same chart as production-breakdown, whose Consumption series already publishes these numbers.
  example(
    "renewables-share",
    ELECTRICITY_POLICY,
    "REN renewable and non-renewable electricity",
    "Quarter-hour renewable generation, non-renewable generation, consumption, and import balance.",
  ),
  example(
    "interconnection-exchanges",
    ELECTRICITY_POLICY,
    "REN electricity interconnection exchanges",
    "Quarter-hour electricity imports and exports across Portugal's interconnections.",
  ),
  example("gas-consumption", GAS_POLICY, "REN natural gas consumption", "Hourly natural gas consumption by major customer group."),
  example("gas-network-balance", GAS_POLICY, "REN natural gas network balance", "Hourly inputs and outputs for Portugal's high-pressure natural gas network."),
  {
    slug: "ren-installed-capacity-feed",
    title: "REN installed generating capacity",
    description:
      "Installed generating capacity by source for the latest three completed calendar months available from REN. Unpublished and null observations are not reported as zero.",
    config: { source: "ren", service: "installed-capacity" },
    policy: {
      name: "REN monthly capacity",
      version: 2,
      collection: { cadenceSeconds: 604_800, timeoutSeconds: 90, maxBytes: 512 * 1024, historyMode: "changes" },
      serving: SERVING,
    },
    staleAfterSeconds: 1_209_600,
    publisher: "REN · Redes Energéticas Nacionais",
    topics: ["energy"],
  },
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
      serving: SERVING,
    },
    staleAfterSeconds: 3 * 86_400,
    publisher: "REN · Redes Energéticas Nacionais",
    topics: ["energy"],
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
      serving: SERVING,
    },
    staleAfterSeconds: 3 * 86_400,
    publisher: "REN · Redes Energéticas Nacionais",
    topics: ["energy"],
  },
];
