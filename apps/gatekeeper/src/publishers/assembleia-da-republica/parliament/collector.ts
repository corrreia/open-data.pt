import { resolveFeed, type ResolvedFeed, type SourceConfig, type SourceStaging } from "#/index";
import { PARLIAMENT_FEEDS, validateParliamentFeedConfig } from "./parliament";

/** What a Parliament feed's functions are handed when they run: where downloads wait while their digest is compared; without it every collection parses. */
export interface ParliamentContext {
  staging: SourceStaging | undefined;
}

export function resolveParliamentFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "parliament", kinds: PARLIAMENT_FEEDS, validate: validateParliamentFeedConfig });
}
