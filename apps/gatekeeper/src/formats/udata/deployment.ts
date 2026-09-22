import type { LibraryDeployment } from "../../index";
import { UDATA_FEEDS, udataCollector } from "./collector";

export const UDATA_DEPLOYMENT: LibraryDeployment<object> = {
  source: "udata",
  name: "uData portals",
  vars: {},
  library: (_env, publishers) => ({
    kinds: Object.values(UDATA_FEEDS),
    collector: (config) => udataCollector({ config, hosts: publishers.hosts.join(","), transformers: publishers.transformers, fetcher: (input, init) => fetch(input, init) }),
  }),
};
