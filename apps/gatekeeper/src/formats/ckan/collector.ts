import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { CKAN_FEEDS, validateCkanFeedConfig } from "./ckan";

/** What a CKAN feed's functions are handed when they run: the hosts its publishers' feeds name, the only ones it may fetch. */
export interface CkanContext {
  hosts: ReadonlySet<string>;
}

export function resolveCkanFeed(config: SourceConfig, hosts: ReadonlySet<string>): Promise<ResolvedFeed> {
  return resolveFeed(config, {
    library: "ckan",
    kinds: [config.measures ? CKAN_FEEDS.observations : CKAN_FEEDS.resource],
    validate: (value) => validateCkanFeedConfig(value, hosts),
  });
}
