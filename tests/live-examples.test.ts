import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NORMALIZED_PROTOCOL,
  collectNormalized,
  resolveTopicFeed,
  topicCollector,
  type CollectionRequest,
  type ExampleFeed,
  type GatekeeperLibrary,
  type JsonObject,
  type ResolvedFeed,
  type TopicOptions,
} from "@open-data-pt/gatekeeper-shared";
import { ARCGIS_FEEDS, arcgisCollector } from "@open-data-pt/gatekeeper-shared/formats/arcgis";
import { CKAN_FEEDS, ckanCollector } from "@open-data-pt/gatekeeper-shared/formats/ckan";
import { GBFS_FEEDS, gbfsCollector } from "@open-data-pt/gatekeeper-shared/formats/gbfs";
import { GTFS_FEEDS, gtfsCollector } from "@open-data-pt/gatekeeper-shared/formats/gtfs";
import { OGC_FEEDS, ogcCollector } from "@open-data-pt/gatekeeper-shared/formats/ogc";
import { OPENDATASOFT_FEEDS, opendatasoftCollector } from "@open-data-pt/gatekeeper-shared/formats/opendatasoft";
import { UDATA_FEEDS, udataCollector } from "@open-data-pt/gatekeeper-shared/formats/udata";
import { BPSTAT_FEEDS, bpstatCollector } from "@open-data-pt/gatekeeper-shared/sources/bpstat";
import { CARRIS_FEEDS, carrisCollector } from "@open-data-pt/gatekeeper-shared/sources/carris";
import { DGEG_FEEDS, dgegCollector } from "@open-data-pt/gatekeeper-shared/sources/dgeg";
import { EUROSTAT_FEEDS, eurostatCollector } from "@open-data-pt/gatekeeper-shared/sources/eurostat";
import { INE_FEEDS, ineCollector } from "@open-data-pt/gatekeeper-shared/sources/ine";
import { IPMA_FEEDS, ipmaCollector } from "@open-data-pt/gatekeeper-shared/sources/ipma";
import { METRO_FEEDS, metrolisboaCollector } from "@open-data-pt/gatekeeper-shared/sources/metrolisboa";
import { OMIE_FEEDS, omieCollector } from "@open-data-pt/gatekeeper-shared/sources/omie";
import { REN_FEEDS, renCollector } from "@open-data-pt/gatekeeper-shared/sources/ren";
import { isNormalizedFrame } from "../packages/gatekeeper-shared/src/normalized-validation";
import { CITIES_EXAMPLES } from "../packages/gatekeeper-cities/src/examples";
import { ENERGY_EXAMPLES } from "../packages/gatekeeper-energy/src/examples";
import { ENVIRONMENT_EXAMPLES } from "../packages/gatekeeper-environment/src/examples";
import { HEALTH_EXAMPLES } from "../packages/gatekeeper-health/src/examples";
import { MOBILITY_EXAMPLES } from "../packages/gatekeeper-mobility/src/examples";
import { STATISTICS_EXAMPLES } from "../packages/gatekeeper-statistics/src/examples";
import { readFrames } from "../apps/kernel/src/frames";
import { MAX_RECORD_BYTES } from "../apps/kernel/src/blob-budget";
import { jsonAs } from "./support";

/**
 * Collects curated examples from their real sources, the way the kernel
 * would, and reads the output through the kernel's own frame validation.
 * Opt-in because it calls public services: set LIVE_EXAMPLES to "all" or to
 * a comma-separated list of example slugs.
 */
const SELECTED = process.env.LIVE_EXAMPLES?.split(",").map((slug) => slug.trim()).filter(Boolean) ?? [];
const MIB = 1024 * 1024;

/** A deployed var, read from the topic Worker's checked-in Wrangler config so the test never invents one. */
function configured(topic: string, name: string): string {
  const text = new TextDecoder().decode(readFileSync(new URL(`../packages/gatekeeper-${topic}/wrangler.jsonc`, import.meta.url)));
  const value = new RegExp(`"${name}":\\s*"([^"]+)"`).exec(text)?.[1];
  if (!value) throw new Error(`the ${topic} Worker declares no ${name}`);
  return value;
}

function library(kinds: Record<string, { kind: string }>, collector: GatekeeperLibrary["collector"]): GatekeeperLibrary {
  // SAFETY: every `*_FEEDS` table is declared `satisfies Record<string, FeedKindDescription>`.
  return { kinds: Object.values(kinds) as GatekeeperLibrary["kinds"], collector };
}

/** The same wiring the six Workers deploy, with the same vars and the real fetch. */
const TOPICS: Array<{ kind: string; libraries: Map<string, GatekeeperLibrary>; examples: readonly ExampleFeed[] }> = [
  {
    kind: "mobility",
    examples: MOBILITY_EXAMPLES,
    libraries: new Map([
      ["carris", library(CARRIS_FEEDS, (config) => carrisCollector({ config, apiOrigin: configured("mobility", "CARRIS_API_ORIGIN"), fetcher: fetch }))],
      ["metrolisboa", library(METRO_FEEDS, (config) => metrolisboaCollector({
        config,
        apiOrigin: configured("mobility", "METROLISBOA_API_ORIGIN"),
        credentials: { key: process.env.ML_CONSUMER_KEY, secret: process.env.ML_CONSUMER_SECRET },
        fetcher: fetch,
      }))],
      ["gtfs", library(GTFS_FEEDS, (config) => gtfsCollector({ config, hosts: configured("mobility", "GTFS_ALLOWED_HOSTS"), fetcher: fetch }))],
      ["gbfs", library(GBFS_FEEDS, (config) => gbfsCollector({ config, hosts: configured("mobility", "GBFS_ALLOWED_HOSTS"), fetcher: fetch }))],
    ]),
  },
  {
    kind: "energy",
    examples: ENERGY_EXAMPLES,
    libraries: new Map([
      ["ren", library(REN_FEEDS, (config) => renCollector({ config, apiOrigin: configured("energy", "REN_API_ORIGIN"), dataApiOrigin: configured("energy", "REN_DATA_API_ORIGIN"), fetcher: fetch }))],
      ["omie", library(OMIE_FEEDS, (config) => omieCollector({ config, apiOrigin: configured("energy", "OMIE_API_ORIGIN"), fetcher: fetch }))],
      ["dgeg", library(DGEG_FEEDS, (config) => dgegCollector({ config, apiOrigin: configured("energy", "DGEG_API_ORIGIN"), fetcher: fetch }))],
      ["opendatasoft", library(OPENDATASOFT_FEEDS, (config) => opendatasoftCollector({ config, hosts: configured("energy", "OPENDATASOFT_ALLOWED_HOSTS"), fetcher: fetch }))],
    ]),
  },
  {
    kind: "statistics",
    examples: STATISTICS_EXAMPLES,
    libraries: new Map([
      ["ogc", library(OGC_FEEDS, (config) => ogcCollector({ config, hosts: configured("statistics", "OGC_ALLOWED_HOSTS"), fetcher: fetch }))],
      ["udata", library(UDATA_FEEDS, (config) => udataCollector({ config, hosts: configured("statistics", "UDATA_ALLOWED_HOSTS"), fetcher: fetch }))],
      ["ine", library(INE_FEEDS, (config) => ineCollector({ config, apiOrigin: configured("statistics", "INE_API_ORIGIN"), fetcher: fetch }))],
      ["bpstat", library(BPSTAT_FEEDS, (config) => bpstatCollector({ config, apiOrigin: configured("statistics", "BPSTAT_API_ORIGIN"), fetcher: fetch }))],
      ["eurostat", library(EUROSTAT_FEEDS, (config) => eurostatCollector({ config, apiOrigin: configured("statistics", "EUROSTAT_API_ORIGIN"), fetcher: fetch }))],
    ]),
  },
  {
    kind: "health",
    examples: HEALTH_EXAMPLES,
    libraries: new Map([
      ["opendatasoft", library(OPENDATASOFT_FEEDS, (config) => opendatasoftCollector({ config, hosts: configured("health", "OPENDATASOFT_ALLOWED_HOSTS"), fetcher: fetch }))],
    ]),
  },
  {
    kind: "cities",
    examples: CITIES_EXAMPLES,
    libraries: new Map([
      ["arcgis", library(ARCGIS_FEEDS, (config) => arcgisCollector({ config, hosts: configured("cities", "ARCGIS_ALLOWED_HOSTS"), fetcher: fetch }))],
      ["ckan", library(CKAN_FEEDS, (config) => ckanCollector({ config, hosts: configured("cities", "CKAN_ALLOWED_HOSTS"), fetcher: fetch }))],
      ["udata", library(UDATA_FEEDS, (config) => udataCollector({ config, hosts: configured("cities", "UDATA_ALLOWED_HOSTS"), fetcher: fetch }))],
    ]),
  },
  {
    kind: "environment",
    examples: ENVIRONMENT_EXAMPLES,
    libraries: new Map([
      ["ogc", library(OGC_FEEDS, (config) => ogcCollector({ config, hosts: configured("environment", "OGC_ALLOWED_HOSTS"), fetcher: fetch }))],
      ["ipma", library(IPMA_FEEDS, (config) => ipmaCollector({ config, apiOrigin: configured("environment", "IPMA_API_ORIGIN"), fetcher: fetch }))],
      ["arcgis", library(ARCGIS_FEEDS, (config) => arcgisCollector({ config, hosts: configured("environment", "ARCGIS_ALLOWED_HOSTS"), fetcher: fetch }))],
    ]),
  },
];

/** The request the kernel builds for a live collection under this example's policy. */
function liveRequest(example: ExampleFeed, resolved: ResolvedFeed): CollectionRequest {
  const policy = example.policy.collection;
  const outputBytes = policy.maxOutputBytes ?? Math.max(MIB, Math.min(16 * MIB, policy.maxBytes * 4));
  const recordBytes = Math.min(policy.maxRecordBytes ?? 256 * 1024, MAX_RECORD_BYTES);
  return {
    protocol: NORMALIZED_PROTOCOL,
    collectionId: `live_${example.slug}`,
    feed: { id: "feed_live", slug: example.slug, title: example.title, description: example.description },
    resolved,
    feedEpoch: "live",
    mode: { kind: "live" },
    limits: {
      sourceBytes: policy.maxBytes,
      outputBytes,
      frameBytes: Math.min(outputBytes, recordBytes + 16 * 1024),
      recordBytes,
      records: policy.maxRecords ?? 1_000_000,
      products: 64,
    },
    deadline: new Date(Date.now() + policy.timeoutSeconds * 1000).toISOString(),
    observedAt: new Date().toISOString(),
  };
}

const cases = TOPICS.flatMap((topic) => topic.examples
  .filter((example) => SELECTED.includes("all") || SELECTED.includes(example.slug))
  .map((example) => ({ slug: example.slug, example, options: { gatekeeperKind: topic.kind, libraries: topic.libraries } satisfies TopicOptions })));

describe.skipIf(cases.length === 0)("live examples", () => {
  it.each(cases)("collects $slug", async ({ example, options }) => {
    const resolved = await resolveTopicFeed(example.config, options);
    const request = liveRequest(example, resolved);
    const result = await collectNormalized(request, topicCollector(resolved.config, options));
    if (result.kind !== "batch") throw new Error(`${example.slug} returned ${JSON.stringify(result)}`);
    const counts = new Map<string, number>();
    const scope = {
      collectionId: request.collectionId,
      resourceKey: resolved.resourceKey,
      configHash: resolved.configHash,
      feedEpoch: request.feedEpoch,
      mode: request.mode,
      deadline: request.deadline,
    };
    // Buffer the output (at most 16 MiB) so a rejected frame can be shown, not only counted.
    const text = await new Response(result.stream).text();
    const rejected = text.split("\n").find((line) => line !== "" && !isNormalizedFrame(jsonAs<JsonObject>(line)));
    if (rejected !== undefined) {
      const saved = join(tmpdir(), `live-rejected-${example.slug}.json`);
      writeFileSync(saved, rejected);
      throw new Error(`${example.slug} emitted an invalid frame, saved to ${saved}: ${rejected.slice(0, 500)}`);
    }
    for await (const frame of readFrames(new Response(text).body!, request.limits, scope)) {
      counts.set(frame.type, (counts.get(frame.type) ?? 0) + 1);
    }
    console.info(`${example.slug}: ${JSON.stringify(Object.fromEntries(counts))}`);
    expect(counts.get("header")).toBe(1);
    expect(counts.get("complete")).toBe(1);
    expect((counts.get("record") ?? 0) + (counts.get("point") ?? 0)).toBeGreaterThan(0);
  }, 300_000);
});
