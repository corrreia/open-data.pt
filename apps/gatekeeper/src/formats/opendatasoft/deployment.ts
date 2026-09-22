import type { LibraryDeployment } from "#/index";
import { opendatasoftCollector } from "./collector";
import { OPENDATASOFT_FEEDS } from "./opendatasoft";

export const OPENDATASOFT_DEPLOYMENT: LibraryDeployment<object> = {
  source: "opendatasoft",
  name: "Opendatasoft portals",
  vars: {},
  library: (_env, publishers) => ({
    kinds: Object.values(OPENDATASOFT_FEEDS),
    collector: (config) => opendatasoftCollector({ config, hosts: publishers.hosts.join(","), fetcher: (input, init) => fetch(input, init) }),
  }),
};
