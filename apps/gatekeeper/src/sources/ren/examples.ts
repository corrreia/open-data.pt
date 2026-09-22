import type { ExampleFeed } from "../../index";
import type { RenServiceName } from "./ren";

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
} as const;

function example(service: RenServiceName, dataset: string, policy: ExampleFeed["policy"], title: string, description: string): ExampleFeed {
  return {
    slug: `ren-${service}-feed`,
    dataset,
    title,
    description,
    config: { source: "ren", service },
    policy,
    staleAfterSeconds: 3600,
  };
}

export const REN_EXAMPLES: ExampleFeed[] = [
  example(
    "production-breakdown",
    "ren-electricity-system",
    ELECTRICITY_POLICY,
    "REN electricity production breakdown",
    "Quarter-hour electricity consumption, generation by source, storage, and import balance.",
  ),
  // The consumption service reads the same chart as production-breakdown, whose Consumption series already publishes these numbers.
  example(
    "renewables-share",
    "ren-electricity-system",
    ELECTRICITY_POLICY,
    "REN renewable and non-renewable electricity",
    "Quarter-hour renewable generation, non-renewable generation, consumption, and import balance.",
  ),
  example(
    "interconnection-exchanges",
    "ren-electricity-system",
    ELECTRICITY_POLICY,
    "REN electricity interconnection exchanges",
    "Quarter-hour electricity imports and exports across Portugal's interconnections.",
  ),
  example("gas-consumption", "ren-gas-system", GAS_POLICY, "REN natural gas consumption", "Hourly natural gas consumption by major customer group."),
  example("gas-network-balance", "ren-gas-system", GAS_POLICY, "REN natural gas network balance", "Hourly inputs and outputs for Portugal's high-pressure natural gas network."),
  {
    slug: "ren-installed-capacity-feed",
    dataset: "ren-electricity-system",
    title: "REN installed generating capacity",
    description:
      "Installed generating capacity by source for the latest three completed calendar months available from REN. Unpublished and null observations are not reported as zero.",
    config: { source: "ren", service: "installed-capacity" },
    policy: {
      name: "REN monthly capacity",
      version: 2,
      collection: { cadenceSeconds: 604_800, timeoutSeconds: 90, maxBytes: 512 * 1024, historyMode: "changes" },
    },
    staleAfterSeconds: 1_209_600,
  },
  {
    slug: "ren-lng-terminal-balance-feed",
    dataset: "ren-gas-system",
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
    dataset: "ren-gas-system",
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
];
