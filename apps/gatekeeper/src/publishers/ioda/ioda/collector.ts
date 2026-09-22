import { resolveFeed, runTransformer, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "#/index";
import { IODA_FEEDS, collectIodaFeed, iodaHosts, validateIodaFeedConfig } from "./ioda";
import { IodaTransformer } from "./transform";

/** What a Worker hands this library: the feed's configuration, the hosts it may reach, and the fetch it may use. */
export interface IodaCollectorOptions {
  config: SourceConfig;
  /** `IODA_ALLOWED_HOSTS`; only api.ioda.inetintel.cc.gatech.edu is read. */
  hosts: string;
  fetcher: typeof fetch;
  /** Request-window clock only, never an observation timestamp. */
  now?: () => Date;
}

const transformer = new IodaTransformer();

export function resolveIodaFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "ioda", kinds: IODA_FEEDS, validate: validateIodaFeedConfig });
}

export function iodaCollector(options: IodaCollectorOptions): NormalizedCollector {
  const hosts = iodaHosts(options.hosts);
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: (config) => resolveIodaFeed(config),
    source: (_state, mode, signal) =>
      collectIodaFeed(
        options.config,
        hosts,
        (input, init) => options.fetcher(input, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal }),
        mode,
        options.now?.() ?? new Date(),
      ),
    // Each window is a few kilobytes of JSON whose series are read by index, so
    // there is nothing to gain from streaming it.
    normalize: { kind: "buffered", transform: (bytes, context) => runTransformer(transformer, bytes, context) },
  };
}
