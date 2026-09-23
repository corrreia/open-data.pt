import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { MYINFO_FEEDS, validateMyInfoFeedConfig } from "./myinfo";
import { MyInfoTransformer } from "./transform";

/** What a MYINFO feed's functions are handed when they run: the portal's origin, and the operators the publisher folders read. */
export interface MyInfoContext {
  apiOrigin: string;
  operators: ReadonlySet<string>;
}

/** The translator from an operator's portal pages into stops, lines and departures; every MYINFO feed uses it. */
export const MYINFO_TRANSFORMER = new MyInfoTransformer();

/** The normalizer a MYINFO feed's collection is stamped with: the translator's name and version. */
export const MYINFO_NORMALIZER = { id: MYINFO_TRANSFORMER.id, version: MYINFO_TRANSFORMER.version };

/** The operator folder names the publisher folders' feeds name, in the spelling their portal paths use. */
export function myInfoOperators(configs: readonly SourceConfig[]): ReadonlySet<string> {
  return new Set(configs.flatMap((config) => (config.operator ? [config.operator] : [])));
}

export function resolveMyInfoFeed(config: SourceConfig, operators: ReadonlySet<string>): Promise<ResolvedFeed> {
  return resolveFeed(config, {
    library: "myinfo",
    kinds: Object.values(MYINFO_FEEDS),
    validate: (value) => validateMyInfoFeedConfig(value, operators),
  });
}
