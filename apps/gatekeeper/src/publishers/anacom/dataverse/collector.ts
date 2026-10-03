import { fixedOrigin, resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { DATAVERSE_API_ORIGIN, DATAVERSE_FEEDS, validateDataverseFeedConfig } from "./dataverse";

/** What a STAT.ANACOM feed's functions are handed when they run: the one origin its Dataverse API answers on. */
export interface DataverseContext {
  apiOrigin: string;
}

export function resolveDataverseFeed(config: SourceConfig, apiOrigin: string): Promise<ResolvedFeed> {
  return resolveFeed(config, {
    library: "dataverse",
    kinds: DATAVERSE_FEEDS,
    validate: (value) => {
      fixedOrigin(apiOrigin, DATAVERSE_API_ORIGIN);
      return validateDataverseFeedConfig(value);
    },
  });
}
