import type { PublisherDefinition } from "#/catalog/define";
import { FEED as digiPtAs20879Routing } from "./feeds/digi-pt-as20879-routing";
import { FEED as meoAs3243Routing } from "./feeds/meo-as3243-routing";
import { FEED as nosAs2860Routing } from "./feeds/nos-as2860-routing";
import { FEED as nosMadeiraAs15457Routing } from "./feeds/nos-madeira-as15457-routing";
import { FEED as portugalInternetResources } from "./feeds/portugal-internet-resources";
import { FEED as portugalRoutingHistory } from "./feeds/portugal-routing-history";
import { FEED as vodafoneAs12353Routing } from "./feeds/vodafone-as12353-routing";

export const PUBLISHER: PublisherDefinition = {
  name: "RIPE NCC",
  url: "https://www.ripe.net/",
  sources: [{ host: "stat.ripe.net", query: { sourceapp: "open-data.pt" } }],
  logo: "svg",
  // RIPEstat is read with RIPE NCC's permission, and with the `sourceapp` they asked for. See docs/publishers/ripe-ncc.md.
  feeds: [digiPtAs20879Routing, meoAs3243Routing, nosAs2860Routing, nosMadeiraAs15457Routing, portugalInternetResources, portugalRoutingHistory, vodafoneAs12353Routing],
};
