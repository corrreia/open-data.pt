---
name: write-publisher
description: Add or change an open-data.pt publisher, its feeds, or the library that reads them. Use when adding a public data source or a feed, a publisher folder, a format or a publisher's own library, changing how a source is reached, or reviewing any of these.
---

# Writing an open-data.pt publisher

Everything open-data.pt collects belongs to a **publisher**: the institution or operator that made the data, never the portal it was read from. A publisher is one folder, and everything about them is in it:

```
apps/gatekeeper/src/publishers/<publisher>/
  index.ts          who they are, the hosts their data is read from, and every feed of theirs
  feeds/<feed>.ts   one file per feed: what it is, its terms, how often it runs, and its fetch, backfill and transform
  <library>/        shared code for their own API, when they have one
  logo.svg | .png   their mark, when we have one (see ../README.md)
```

The code that reads a standard many publishers share is a **format**, under `apps/gatekeeper/src/formats/<format>/`: `arcgis`, `ckan`, `gbfs`, `gtfs`, `myinfo`, `ngsi`, `ogc`, `opendatasoft`, `udata`, `wfs`. A format and a publisher's own library are both **libraries**; the one Gatekeeper Worker carries every library in `apps/gatekeeper/src/libraries.ts` and runs every feed every publisher lists.

A library is **how** data is read, never what it is about or who publishes it. Topics overlap — a municipal Wi-Fi map is `cities` and `telecom` — and a publisher may be read two ways (Carris Metropolitana through `carris` and `gtfs`; ten publishers through `udata` on dados.gov.pt), so neither is a code boundary.

## Start by reading

1. `CONTEXT.md`
2. `apps/gatekeeper/src/catalog/define.ts` — `PublisherDefinition`, `FeedDefinition`, `defineFeed`
3. `apps/gatekeeper/src/library.ts` — `LibraryDeployment`, `FeedContext`, `FeedFunctions`, `feedCollector`
4. `apps/gatekeeper/src/publisher-client.ts` — what a feed's `fetch` does
5. one small publisher end to end: `publishers/dgeg/` (own library, buffered JSON), `publishers/boa-viagem/` (a format), or `publishers/cm-porto/` (CKAN, streaming)
6. `apps/gatekeeper/src/catalog/index.ts` and `gatekeeper.ts` — how the folders become the catalog and the RPC
7. `packages/contract/src/index.ts` and `apps/gatekeeper/src/normalized.ts` — the RPC and the normalized stream

## A new feed

A file under the publisher's `feeds/`, and one line in their `index.ts`. Nothing else.

```ts
// apps/gatekeeper/src/publishers/boa-viagem/feeds/network.ts
export const FEED = defineFeed(MYINFO_DEPLOYMENT, {
  slug: "boa-viagem-network-feed", // its identity: never changes once merged
  title: "Boa Viagem stops and lines",
  description: "Every bus stop Boa Viagem serves north of Lisbon, with its position, and every line and direction it runs.",
  licence: "source-terms", // a key of LICENCES: the terms the publisher states, or source-terms
  attribution: "Boa Viagem via myinfo.4cloud.pt",
  topics: ["mobility"], // keys of TOPICS
  config: { feed: "network", operator: "BoaViagem" }, // never changes once merged; no `source`
  policy: MYINFO_NETWORK_POLICY,
  staleAfterSeconds: 172_800,
  fetch: ({ config, validator, library, fetch }) => collectMyInfoFeed(config, validator, library.apiOrigin, library.operators, fetch),
  transform: { normalizer: MYINFO_NORMALIZER, buffered: (bytes, context) => runTransformer(MYINFO_TRANSFORMER, bytes, context) },
});
```

- `defineFeed(<LIBRARY>_DEPLOYMENT, …)` names the library whose shared code the feed calls. That library works out the feed's identity from its `config` and adds `source: "<library>"`, which routes it inside the Worker. `slug` and `config` are what its history hangs on.
- Name the file for the slug, without `-feed` and without the publisher's key: `network.ts`, `river-levels.ts`.
- Every feed states its own terms. Siblings that share them share one constant, the way they share a policy; nothing is inherited from the publisher, so one file says everything about its feed.
- `fetch` is the live read the kernel runs every `policy.collection.cadenceSeconds`. `backfill(context, cursor)`, when the source keeps history, walks back one older slice at a time. `transform` turns what was fetched into products: `{ normalizer: { id, version }, buffered(bytes, context, metadata) }` or `streaming(body, context, metadata)`. A fetch that learns something its transform needs (CKAN's resource title and format) returns `{ fetch, metadata }` (`Described`).
- A feed is handed `{ config, state, validator, signal, fetch, library, now }`: `fetch` is its publisher's client, aborted with the collection; `library` is what the library's deployment built from the Worker (an origin, allowed hosts, a secret).
- A feed of a format a publisher needs read differently (a file laid out only their way) calls a translator in their folder: `publishers/cm-cadaval/municipal-waste.ts`.
- `apps/gatekeeper/tests/fixtures/feed-identity.json` pins every feed's resource key and kind. A new feed adds its line (`vitest -u` on that test); a changed line on an existing feed means every collection of it starts over — only ever on purpose.

## A new publisher

A folder named for their key, with an `index.ts`, at least one feed, and `pnpm catalog`, which adds the folder to `catalog/folders.generated.ts` (a test fails when it is stale).

```ts
export const PUBLISHER: PublisherDefinition = {
  name: "Câmara Municipal do Porto", // as a heading shows it
  url: "https://www.cm-porto.pt/", // their website, for people
  sources: ["dadosabertos.cm-porto.pt"], // where their data is read from
  logo: "svg",
  feeds: [portoCulturalAgenda, portoLoadingZones /* …, each imported from ./feeds/ */],
};
```

- **Who made the data, never the portal.** dados.gov.pt holds ten publishers and is none of them; name whoever put the data there. `CONTEXT.md` says how to decide.
- **`sources`** are the only hosts their feeds can reach, including where a download link redirects. A host entry may carry `query` (parameters the publisher asked every request to carry — RIPEstat's `sourceapp`), `minIntervalSeconds` (the least time between two requests to it, from every feed at once — for a slow server or one that asked for it) and `userAgent` (another name for that host, with a comment saying why). The client names open-data.pt in every request otherwise; a library never sets its own `User-Agent`. A test fails when a feed's config or its library's vars name a host its publisher does not list.
- **A hold:** a publisher we may not republish yet carries `enabled: false` and a comment saying what we are waiting for. Their code ships; nothing of theirs is installed or served. Lifting it is deleting one line.
- **A logo** is optional: `logo.svg` or `logo.png` beside the `index.ts`, `logo` naming its extension; `publishers/README.md` says what a usable one is.
- **A page under `docs/publishers/`** only when reading them takes knowledge the code does not carry: a credential, a proxy, a permission, a pace, a habit of the source. Its README says what a page holds.
- A shared file of theirs must not import their own `index.ts`: it imports the feeds, which import the shared file.

## A new library

A publisher's own API: a folder in their folder, `publishers/<publisher>/<name>/`. A standard many publishers share: a folder under `formats/<name>/`. Either way:

- `<name>.ts` — feed kinds, validation, fetching; `transform.ts` — bytes to products; `collector.ts` — how a feed's identity is resolved (`resolveFeed`) and what its feeds are handed; `deployment.ts`; `index.ts`, the barrel; and fixture tests under `tests/`.
- `deployment.ts` exports `<NAME>_DEPLOYMENT: LibraryDeployment<Env, Context>`: `source` (the key feeds route by, and the folder's name), a human `name`, `vars` with their values (`<NAME>_API_ORIGIN` for a fixed origin), any `secrets`, `r2Buckets` and `cpuMs`, and `library(env, publishers, fetcher)`, which returns `{ kinds, resolve, context }`. `publishers.hosts` are the hosts its publishers declare — the only ones a format may allow; `publishers.configs` every configuration that reads through it; `fetcher` what `resolve` reads with when checking a feed against the source (wrap it in `publisherClient(publishers.hosts, fetcher)`).
- One line in `libraries.ts`. A test holds every folder with a `deployment.ts` to being listed. Nothing else changes: no package, no binding, no script.
- A secret or bucket is bound in `apps/gatekeeper/wrangler.jsonc` under the declared name (Metro Lisboa's `ML_CONSUMER_KEY`/`ML_CONSUMER_SECRET`, Parliament's `PARLIAMENT_STAGING`). The Worker's CPU limit is the largest any library declares.
- A feed kind declares only what the platform reads: `semantics.domainSubject`, `semantics.defaultProductRole`, and `history.earliest` when the source states one.

## Design the source first

From primary documentation and representative responses, establish:

- the publisher, and the hosts their data is actually read from;
- resource identity, and stable versus provisional identifiers;
- pagination and history cursor behaviour, and how far back the source goes;
- validators for every component, publication clocks and the expected cadence;
- source and expanded-output bounds, and how fast the source may be read — a history walk multiplies every request;
- completeness, deletion and retraction, and expected failures;
- the products, their fields, types and units; and
- the licence the publisher states, the attribution they ask for, and the topics.

## What the Gatekeeper owns

Upstream access, parsing, validation, normalization, source clocks, validators, coverage, and source-supported history. It never returns original source bytes to the kernel and owns no canonical storage. The kernel owns semantic comparison, revisions, the history outbox, checkpoint commitment, serving, and what a batch authorizes: rejected rows make a product partial, and only a complete authoritative snapshot retracts.

The RPC is `describe`, `listFeedKinds`, `resolveFeed`, `collect`, `exampleFeeds`, `catalog` and `catalogVersion`. Every feed of an enabled publisher is installed by the kernel's Registry, which syncs within a minute of a new Gatekeeper answering (its catalog version changes) and every 15 minutes otherwise: new feeds are installed, changed ones updated under the same ID, removed ones retired. The kernel checks every answer's shape exactly, so a new field on an existing answer breaks a kernel still on the last release: add a method, or make the kernel accept both first.

## Fetching

- A feed's `fetch` returns a `SourceFetch`: `{ kind: "body", body, provenance: { sourceUrl, sourcePublishedAt? }, completeness, next?, exhausted?, validator?, state? }`, `{ kind: "not-modified", validator? }` (live only), or `{ kind: "exhausted" }` (history only). `sourceUrl` is the link the product page shows: what a browser can open, otherwise the publisher's documentation.
- Use the `fetch` the feed is handed, never the global one. Build paths from validated identifiers; accept HTTPS without embedded credentials.
- Throw `GatekeeperError(…, "upstream-error", retryAfterSeconds)` for a non-2xx answer. `retryAfterSeconds`, `readBoundedResponse`, `readBoundedJson`, `contentEtag`, `responseValidator`, `sourceValidator`, `fixedOrigin`, `allowedHosts` and the Lisbon clock helpers are exported from `#/index`.
- Treat `304` as unchanged only when every required component is covered; a compound feed fetches all of them unless independent validators prove all unchanged.
- A large source with no ETag or Last-Modified can stage its body in an R2 bucket (`r2Staging`) and keep the digest in its checkpoint state: an unchanged digest answers `not-modified`. A staging bucket is a cache, never canonical storage.
- Keep history exhaustion explicit. Invalid cursors are failures. Never claim a history the upstream does not support.
- A history walk is paced by the kernel per library; a slow server also gets its host's `minIntervalSeconds`. Count what a full walk sends before shipping one: SNIRH's first, 4-day slices over ten years of hourly readings, got open-data.pt blocked by name.

## Normalizing

- Stream whenever the format allows (CSV, NDJSON, JSON arrays, GeoJSON features, ZIP entries): `streamCsvRecords`, `streamJsonArray`, `streamNdjson`; declare products up front, yield rows lazily, and report what is only known at the end through `finish().products`. Otherwise buffer; buffered bodies are capped at 16 MiB.
- The stream is one header (protocol, collection ID, normalizer, product keys, schemas, update declarations, provenance, completeness, candidate checkpoint), one bounded frame per record or point, and a mandatory completion frame. An error after the header truncates the stream, which the kernel rejects; never catch it and complete.
- Date rows by the source's own clock, never by when you polled: the poll time on an unchanged row makes a new revision every collection. Use it only for a reading that is a measurement taken then.
- Publish each value once: a statistical indicator is one series, not a table and a series of the same numbers. A series beside a table only when it carries what the table does not (a count, a median, a total per period).
- Whether a product keeps history is the policy's decision: under `historyMode: "changes"`, `collection.withoutHistory` lists what moves rather than changes (vehicle positions) and copies of values another product records.
- `authoritative-snapshot` only when omission is authoritative across the declared scope; otherwise `partial-snapshot`, `delta` or `source-window`.
- Never infer measures from columns that merely look numeric: phone numbers, codes and identifiers are not measurements.
- Bump the normalizer version whenever the products or their meaning change.

## Test

- Fixture tests beside the code, under its `tests/`, with saved source responses under `tests/fixtures/`. No network, no module mocking: inject a `fetcher`. `feedCollection(slug, { fetcher })` from `#/tests/catalog` runs a feed exactly as the Worker does, against a fixture.
- Cover: config validation and hosts; upstream errors, malformed data and byte caps; conditional requests; resolution identity; framing, counts and size limits; streaming in 1-byte chunks; history and exhaustion; determinism independent of the poll clock.
- `pnpm test:publisher <key>` runs one publisher's tests; `pnpm test:publisher <key> --live` collects their feeds from the real sources.
- `pnpm dev <library>` runs the kernel and the Gatekeeper carrying that library alone.
- Run the checks in `AGENTS.md` one at a time. A change to what the kernel and the Gatekeeper exchange is proven only by running the new pair and loading the site. Do not deploy.

## Review order

1. data exposure, and hosts a publisher did not declare;
2. original bytes crossing the RPC boundary;
3. unbounded source or normalized output, and a history walk the source cannot take;
4. checkpoint and no-op mistakes, especially in compound feeds;
5. history and exhaustion semantics;
6. lossy or misleading normalization or identity;
7. terms: the licence the publisher states, their attribution, and the right publisher;
8. an answer shape a kernel on the last release would refuse;
9. missing tests and documentation drift.

## Done when

A feed is done when its file states what it is and its terms, its publisher lists it, its identity is pinned, and it has been collected once from the real source. A publisher is done when their folder holds everything about them, their `sources` name every host their feeds reach, and `pnpm catalog` has run. A library is done when it holds all the parsing, is bounded in source and output, honest about coverage and identity, covered by fixture tests, its `deployment.ts` declares everything it reads, and it is listed in `libraries.ts`. The Worker passes `pnpm deploy:dry-run`.
