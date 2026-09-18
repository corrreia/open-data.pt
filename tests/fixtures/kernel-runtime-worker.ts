import { WorkerEntrypoint } from "cloudflare:workers";
import {
  GatekeeperError,
  asArray,
  asObject,
  asString,
  bufferedTransform,
  collectNormalized,
  parseJson,
  resolveFeed,
  type CanonicalRecord,
  type CollectionRequest,
  type CollectionResult,
  type ExampleFeed,
  type FeedGatekeeper,
  type FeedKindDescription,
  type GatekeeperDescription,
  type ResolvedFeed,
  type SourceConfig,
} from "@open-data-pt/gatekeeper-shared";
import { REGISTRY_ROOM } from "../../apps/kernel/src/coordinators";
import { handleApi } from "../../apps/kernel/src/http";
import KernelWorker from "../../apps/kernel/src/index";
export { Registry, FeedRunner, CollectionWorkflow } from "../../apps/kernel/src/index";

const ROWS_KEY = "fixture/rows.json";
const EXAMPLE_KEY = "fixture/example.json";

/**
 * The kernel, with test-only routes: what the fixture source returns and the
 * fixture Gatekeeper lists next, one sync of the Registry, and direct reads of
 * the Registry and runners. Nothing here administers feeds; the kernel runs them.
 */
export default class RuntimeTestWorker extends KernelWorker {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "PUT" && (url.pathname === "/test/source" || url.pathname === "/test/example")) {
      await this.env.DATA_OBJECTS.put(url.pathname === "/test/source" ? ROWS_KEY : EXAMPLE_KEY, await request.text());
      return Response.json({ stored: true });
    }
    // The API without the edge cache: what the Registry selects right now.
    if (url.pathname.startsWith("/test/api/")) return handleApi(new Request(new URL(`${url.pathname.slice("/test".length)}${url.search}`, url.origin)), this.apiContext());
    const registry = this.env.Registry.getByName(REGISTRY_ROOM);
    if (request.method === "POST" && url.pathname === "/test/sync") {
      // What the Registry alarm does, without waiting for the next check: compare the catalog, then apply until nothing is queued.
      let checked = false;
      for (let step = 0; step < 50; step += 1) {
        const progress = await registry.syncExamples(true);
        checked ||= progress.checked;
        if (checked && progress.pending === 0) return Response.json({ data: progress });
      }
      return Response.json({ error: "The sync did not settle" }, { status: 500 });
    }
    if (url.pathname === "/test/feeds") return Response.json({ data: await registry.listFeeds() });
    // The history slots as the Registry itself counts them: take the named slots, then release them.
    if (request.method === "POST" && url.pathname === "/test/history-slots") {
      // SAFETY: this route is only ever called by kernel-runtime.test.ts, which sends both arrays.
      const { take, release } = (await request.json()) as { take: string[]; release: string[] };
      const taken: boolean[] = [];
      for (const id of take) taken.push(await registry.tryStartHistoryQuery(id));
      for (const id of release) await registry.finishHistoryQuery(id);
      return Response.json({ taken });
    }
    const productRoute = /^\/test\/products\/([^/]+)$/.exec(url.pathname);
    if (productRoute?.[1]) return Response.json({ data: (await registry.getProduct(productRoute[1])) ?? null });
    const runnerRoute = /^\/test\/feeds\/([^/]+)(\/acquisitions)?$/.exec(url.pathname);
    if (runnerRoute?.[1]) {
      const runner = this.env.FeedRunner.getByName(runnerRoute[1]);
      return Response.json({ data: runnerRoute[2] ? await runner.listAcquisitions(20) : (await runner.feed()) ?? null });
    }
    return super.fetch(request);
  }
}

const KIND: FeedKindDescription = {
  kind: "things",
  title: "Things",
  description: "Rows the runtime test controls",
  semantics: { domainSubject: "reference", defaultProductRole: "reference" },
};

/** A real Gatekeeper entrypoint reached over a service binding; its source and its example are objects the test writes. */
export class FixtureGatekeeper extends WorkerEntrypoint<Env> implements FeedGatekeeper {
  override async fetch(): Promise<Response> {
    return new Response("RPC only", { status: 404 });
  }

  async describe(): Promise<GatekeeperDescription> {
    return { kind: "fixture", name: "Fixture" };
  }

  async listFeedKinds(): Promise<FeedKindDescription[]> {
    return [KIND];
  }

  async resolveFeed(config: SourceConfig): Promise<ResolvedFeed> {
    return resolveFeed(config, { gatekeeperKind: "fixture", kinds: [KIND], validate: (value) => value });
  }

  async collect(request: CollectionRequest): Promise<CollectionResult> {
    return collectNormalized(request, {
      normalizer: { id: "fixture", version: "1" },
      resolve: (config) => this.resolveFeed(config),
      source: async () => {
        const object = await this.env.DATA_OBJECTS.get(ROWS_KEY);
        const text = object ? await object.text() : "{\"rows\":[]}";
        if (asObject(parseJson(text))?.deny === true) throw new GatekeeperError("Source refused the request", "source-denied");
        return { kind: "body", body: new TextEncoder().encode(text), provenance: { sourceUrl: "r2://fixture/rows.json" }, completeness: "complete" };
      },
      normalize: {
        kind: "buffered",
        transform: (bytes) => {
          const rows = asArray(asObject(parseJson(new TextDecoder().decode(bytes)))?.rows) ?? [];
          const records: CanonicalRecord[] = rows.flatMap((row) => {
            const value = asObject(row);
            const key = asString(value?.key);
            return value && key ? [{ entityKey: key, payload: { name: asString(value.name) ?? key, lat: 38.7, lon: -9.1 } }] : [];
          });
          return {
            transformer: { id: "fixture", version: "1" },
            products: [{ productKey: "things", slug: "fixture-things", title: "Fixture things", description: "Runtime fixture", role: "reference", kind: "record", schema: { fields: [{ id: "name", name: "Name", type: "string", nullable: false }, { id: "lat", name: "lat", type: "latitude", nullable: false }, { id: "lon", name: "lon", type: "longitude", nullable: false }] }, updateMode: "authoritative-snapshot", completeness: "complete", records }],
            quality: { acceptedRecords: records.length, rejectedRecords: 0 },
          };
        },
      },
    });
  }

  async exampleFeeds(): Promise<ExampleFeed[]> {
    const stored = await this.env.DATA_OBJECTS.get(EXAMPLE_KEY);
    const title = asString(asObject(parseJson(stored ? await stored.text() : "{}"))?.title) ?? "Fixture things";
    return [{
      slug: "fixture-things", title, description: "Runtime fixture", config: { source: "fixture", feed: "things" }, staleAfterSeconds: 3600,
      policy: { name: "Fixture", version: 1, collection: { cadenceSeconds: 3600, timeoutSeconds: 30, maxBytes: 1024 * 1024, historyMode: "changes" }, serving: {} },
    }];
  }
}

export { bufferedTransform };
