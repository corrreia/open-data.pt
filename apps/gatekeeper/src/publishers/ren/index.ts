import type { PublisherDefinition } from "#/catalog/define";
import { FEED as installedCapacity } from "./feeds/installed-capacity";
import { FEED as interconnectionExchanges } from "./feeds/interconnection-exchanges";
import { FEED as productionBreakdown } from "./feeds/production-breakdown";
import { FEED as renewablesShare } from "./feeds/renewables-share";
import { FEED as gasConsumption } from "./feeds/gas-consumption";
import { FEED as gasNetworkBalance } from "./feeds/gas-network-balance";
import { FEED as gasStorage } from "./feeds/gas-storage";
import { FEED as lngTerminalBalance } from "./feeds/lng-terminal-balance";

export const PUBLISHER: PublisherDefinition = {
  name: "REN · Redes Energéticas Nacionais",
  url: "https://www.ren.pt/",
  sources: ["datahub.ren.pt", "servicebus.ren.pt"],
  logo: "svg",
  feeds: [
    // The consumption service reads the same chart as production-breakdown, whose Consumption series already publishes these numbers, so it has no feed.
    installedCapacity,
    interconnectionExchanges,
    productionBreakdown,
    renewablesShare,
    gasConsumption,
    gasNetworkBalance,
    gasStorage,
    lngTerminalBalance,
  ],
};
