import type { ExampleFeed } from "../../index";
import type { RenServiceName } from "./ren";

const POLICY = {
  name: "REN intraday chart data",
  version: 2,
  collection: {
    cadenceSeconds: 900,
    timeoutSeconds: 30,
    maxBytes: 2 * 1024 * 1024,
    historyMode: "changes",
  },
  serving: {
    licence: "REN Data Hub terms of use",
    attribution: "REN — Redes Energéticas Nacionais",
  },
} as const;

function example(
  service: RenServiceName,
  title: string,
  description: string,
): ExampleFeed {
  return {
    slug: `ren-${service}-feed`,
    title,
    description,
    config: { source: "ren", service },
    policy: POLICY,
    staleAfterSeconds: 3600,
    publisher: "REN · Redes Energéticas Nacionais",
    topics: ["energy"],
  };
}

export const REN_EXAMPLES: ExampleFeed[] = [
  example(
    "production-breakdown",
    "REN electricity production breakdown",
    "Quarter-hour electricity consumption, generation by source, storage, and import balance.",
  ),
  example(
    "consumption",
    "REN electricity consumption",
    "Quarter-hour electricity consumption in mainland Portugal.",
  ),
  example(
    "renewables-share",
    "REN renewable and non-renewable electricity",
    "Quarter-hour renewable generation, non-renewable generation, consumption, and import balance.",
  ),
  example(
    "interconnection-exchanges",
    "REN electricity interconnection exchanges",
    "Quarter-hour electricity imports and exports across Portugal's interconnections.",
  ),
  example(
    "gas-consumption",
    "REN natural gas consumption",
    "Hourly natural gas consumption by major customer group.",
  ),
  example(
    "gas-network-balance",
    "REN natural gas network balance",
    "Hourly inputs and outputs for Portugal's high-pressure natural gas network.",
  ),
];
