import { resolveFeed, runTransformer, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "#/index";
import { MYINFO_FEEDS, collectMyInfoFeed, validateMyInfoFeedConfig } from "./myinfo";
import { MyInfoTransformer } from "./transform";

/** What a Worker hands this library: the feed's configuration, the portal origin, the operators it may read, and the fetch it may use. */
export interface MyInfoCollectorOptions {
  config: SourceConfig;
  /** `MYINFO_ORIGIN`. */
  apiOrigin: string;
  /** `MYINFO_OPERATORS`, comma-separated portal folder names. */
  operators: string;
  fetcher: typeof fetch;
}

const transformer = new MyInfoTransformer();

/** The operator names a Worker allows, kept in the spelling their portal paths use. */
export function myInfoOperators(value: string): ReadonlySet<string> {
  return new Set(
    value
      .split(",")
      .map((operator) => operator.trim())
      .filter((operator) => operator !== ""),
  );
}

export function resolveMyInfoFeed(config: SourceConfig, operators: ReadonlySet<string>): Promise<ResolvedFeed> {
  return resolveFeed(config, {
    library: "myinfo",
    kinds: Object.values(MYINFO_FEEDS),
    validate: (value) => validateMyInfoFeedConfig(value, operators),
  });
}

export function myInfoCollector(options: MyInfoCollectorOptions): NormalizedCollector {
  const operators = myInfoOperators(options.operators);
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: (value) => resolveMyInfoFeed(value, operators),
    source: (state, mode, signal) => {
      if (mode.kind === "history") throw new Error("MYINFO portals publish no historical timetables");
      return collectMyInfoFeed(options.config, sourceValidator(state), options.apiOrigin, operators, (input, init) => options.fetcher(input, { ...init, signal }));
    },
    normalize: { kind: "buffered", transform: (bytes, context) => runTransformer(transformer, bytes, context) },
  };
}
