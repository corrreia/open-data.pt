---
name: write-gatekeeper
description: Create, modify, or review open-data.pt Gatekeeper libraries and topic Workers. Use when adding a public data source, adding a format or source library, changing the Gatekeeper RPC contract, wiring a GATEKEEPER_* binding, or working on source synchronization behavior.
---

# Writing an open-data.pt Gatekeeper

A Gatekeeper is one Cloudflare Worker per catalog topic — `cities`, `economy`, `energy`, `environment`, `government`, `health`, `mobility`, `society`, `telecom` — reached through private RPC. Together they own upstream access, parsing, validation, normalization, source clocks, validators, coverage, and source-supported history. They never return original source bytes to the kernel and own no canonical storage.

The code that does the reading is a **library**, not a Worker (ADR 0015):

```
packages/gatekeeper-shared/src/formats/<format>/   arcgis  ckan  opendatasoft  gtfs  gbfs  udata  ogc
packages/gatekeeper-shared/src/sources/<name>/     carris  metrolisboa  ipma  dgeg  ine  ren  omie  bpstat  eurostat  parliament  ripestat  peeringdb
packages/gatekeeper-<topic>/src/                   index.ts (wiring) and examples.ts (what it owns)
```

A library is `<name>.ts` (feed kinds, validation, fetching), `transform.ts` (bytes to products), `examples.ts`, `collector.ts` (`<name>Collector(options)`), and `index.ts` (the barrel). It exports its feed-kind table, `validate<Name>FeedConfig`, `collect<Name>Feed`, its transformer, exactly one examples array, and the collector factory.

A Worker contains no parsing. It names its libraries in `libraries()`, hands each the vars and secrets it needs, lists the examples it owns, and routes. Routing is one rule: every example configuration carries `source: "<library>"`; `resolveTopicFeed` and `topicCollector` pick the library from it, and the library validates the rest of the configuration and never sees that key. `listFeedKinds()` returns the union of the Worker's libraries' kinds, each renamed `<library>:<kind>`; a resolved resource key is `<topic>:<library>:<kind>:<digest>`.

## One Worker per topic

A topic is what the data is about, never who publishes it or how it is published. There is no `statistics`, `open-data-portal` or per-publisher Worker: INE's indicators are split across `economy`, `society`, `mobility` and `telecom`, and dados.gov.pt feeds across `cities`, `government`, `health` and `society`.

- A feed lives in a Worker whose topic its `topics` list carries. When a feed carries several Worker topics, pick the one it is most about and put it first (INE and Eurostat select by first topic). `tests/examples-consistency.test.ts` fails on a feed in a Worker whose topic it does not carry.
- A library several topics need is wired into each of those Workers, with the same var values, and each Worker's `examples.ts` selects its share.
- A new source whose topic has no Worker gets a new package under `packages/gatekeeper-<topic>/`, not a place in the nearest existing Worker.
- Telecommunications data (INE's telecom surveys, RIPEstat routing, PeeringDB exchanges) is `gatekeeper-telecom`.
- A source under a publication hold (`packages/gatekeeper-shared/src/publication-holds.json`: Parliament, RIPEstat, PeeringDB) is wired into its topic Worker's `libraries()` with its vars, but its examples stay out of that Worker's `examples.ts` until the owner lifts the hold. Every library must be wired into some Worker; the consistency test checks that too.

Feed slugs never change: a feed's ID derives from its slug, so moving a feed between Workers keeps its history.

## Start with the current contract

Read completely:

1. `CONTEXT.md`
2. `README.md`, the Gatekeepers and Collection sections
3. `packages/gatekeeper-shared/src/index.ts`
4. `packages/gatekeeper-shared/src/normalized.ts` and `stream.ts`
5. `packages/gatekeeper-shared/src/library.ts` (the routing every topic Worker uses)
6. a small existing library and its tests (`sources/ipma` for buffered JSON, `formats/udata` tabular or `formats/gtfs` for streaming)
7. one topic Worker, `packages/gatekeeper-environment/src/`, which is two libraries and nothing else
8. `apps/kernel/src/gatekeeper-registry.ts`

Earlier contracts (v1 and v2 normalized streams, raw `collect(config, checkpoint)`, public `transform`, `collectHistory`, `x-open-data-*` response headers, late records, batch checksums) are retired. Do not add compatibility overloads, raw capture, replay, or artifact storage.

## Responsibilities

A Gatekeeper:

- resolves a string-valued source configuration to canonical config, exact resource identity, feed kind/semantics, and source-supported history;
- restricts all outbound hosts and constructs paths from validated identifiers;
- handles provider pagination, rate limits, source response caps, and quirks;
- parses and normalizes untrusted responses inside its Worker;
- preserves source identity, event/publication clocks, completeness, and explicit source operations;
- implements source-supported history through `CollectionRequest.mode`;
- returns a typed result whose batch variant contains one bounded byte-oriented `open-data-normalized/4` NDJSON stream using `collectNormalized`; and
- keeps pure normalizers as internal test seams.

The kernel owns semantic comparison, the entity index, revisions, the history outbox, checkpoint commitment, serving publication, and public authorization. It also decides what a batch authorizes: rejected rows make a product partial, and only a complete authoritative snapshot can retract.

## Design the source

Before implementation establish from primary documentation and representative responses:

- source system, resource identity, and allowed hosts;
- feed semantics and stable/provisional identifiers;
- pagination and history cursor behavior;
- independent validators for every required component;
- source publication/update clocks and expected cadence;
- source and expanded-output bounds;
- completeness, deletion/retraction behavior, and expected failures;
- normalized products, field types, units, and identity uncertainty; and
- publisher, topics, licence, and attribution.

Archive-only document/media/coverage feeds are unsupported unless explicitly approved as a published asset product.

## Implement the library

Most work is a library, not a Worker. Add a directory under `formats/` or `sources/`, export the surface above, and wire it into the Worker of its topic with one entry in that Worker's `libraries()` map and one namespaced var (`<LIBRARY>_ALLOWED_HOSTS` for an allowlist, `<LIBRARY>_API_ORIGIN` for a fixed origin). A library that two topics carry declares its var in both, with the same value.

A new dataset from a source already read is one entry in that library's `examples.ts` and nothing else. Check the owning Worker's `examples.ts` picks it up: ArcGIS is split between `cities` and `environment` by slug prefix, Opendatasoft between `energy` and `health`, INE and Eurostat by first topic, uData by topic, and OGC between `society` (DGT) and `environment` (Azores).

## Implement the Worker

Use the existing package shape. The default export extends `WorkerEntrypoint<Env>`, implements `FeedGatekeeper`, and returns 404 from public HTTP.

The RPC surface is:

- `describe()`
- `listFeedKinds()`
- `resolveFeed(config)`
- `collect(request)`
- `exampleFeeds()` (every example becomes a feed automatically: the Registry installs new ones, updates changed ones in place and retires removed ones, all enabled)

A topic Worker implements `resolveFeed` with `resolveTopicFeed(config, this.topic())` and `collect` with `collectNormalized(request, topicCollector(request.resolved.config, this.topic()))`. A library's `<name>Collector(options)` returns the `NormalizedCollector` those drive: `{ normalizer, resolve, source, normalize }`.

- `source(state, mode, signal)` returns a typed `SourceFetch`: `{ kind: "body", body, provenance: { sourceUrl, sourcePublishedAt? }, completeness, next?, exhausted?, validator?, state? }`, `{ kind: "not-modified", validator? }` (live only), or `{ kind: "exhausted" }` (history only). `sourceUrl` is the link the product page shows: the URL fetched when a browser can open it, otherwise the publisher's documentation or landing page (Metro Lisboa's API needs keys, REN's answers only POSTs). It receives the complete source-owned state only when resource, canonical configuration, semantic feed epoch, and normalizer identity/version match. Use `sourceValidator(state)` for the checkpoint's HTTP validators, `responseValidator(headers)` to forward upstream ETag/Last-Modified, and `state: {}` to drop validators a source has stopped honouring. Throw `GatekeeperError(..., "upstream-error", retryAfterSeconds)` for non-2xx upstream responses; `retryAfterSeconds(headers)`, `readBoundedResponse`, `readBoundedJson`, `contentEtag`, `allowedHosts`, `fixedOrigin` and the Europe/Lisbon clock helpers are all in the shared package.
- `normalize` is `{ kind: "streaming", transform(body, context) }` whenever the format can be read row by row (CSV, NDJSON, JSON arrays, GeoJSON features, ZIP entries): use `streamCsvRecords`, `streamJsonArray` or `streamNdjson`, declare products up front, yield rows lazily, and report values only known at the end (inferred schema, watermark, a product that turned out absent as `completeness: "unknown"`) through `finish().products`. Otherwise use `{ kind: "buffered", transform(bytes, context) }`; buffered bodies are capped at 16 MiB whatever the policy says.
- Do not expose the normalizer as a Worker RPC method.
- Date rows by the source's own clock, never by when you polled. `eventTime`, `validFrom`, `sourcePublishedAt` and a point's time are part of what the kernel compares, so `context.observedAt` on a record or point that did not change makes it a new revision, a lake row and a window rewrite on every collection. Use the poll time only for a reading that genuinely is a measurement taken then (a count of vehicles on the road now). A value that is revised during a period gets that period's stamp (a daily median is dated by its day), and an aggregate of an unfinished period is not emitted until the period ends.

The normalized stream has:

- one header containing protocol, logical collection ID, normalizer, stable product keys, product schemas/update declarations, provenance, the source body's completeness, and candidate checkpoint;
- one bounded product-keyed frame per record or point; and
- one mandatory completion frame with counts, quality, and optional product finalizations.

The shared helper enforces source, output, frame, row, record, and deadline limits, and pulls one row per kernel read, so neither side holds the dataset. A producer error after the header creates a truncated stream, which the kernel rejects. Never catch such an error and emit a successful completion frame.

## Source boundary rules

- Accept HTTPS source URLs without embedded credentials.
- Restrict outbound hosts through deployment configuration.
- Prefer streaming; bound every buffered response before reading it fully.
- Keep format-specific caps and streaming archive extraction where applicable; do not keep row caps that only protected memory (the kernel enforces `limits.records`).
- Do not assume source byte size bounds expanded normalized output.
- Await every request and operation; keep request state out of module globals.
- Wrap platform fetch as `(input, init) => fetch(input, init)`.
- Treat `304` as unchanged only when every required component is covered. For a compound feed, fetch all components unless independent validators prove all unchanged.
- Keep history exhaustion explicit (`{ kind: "exhausted" }` or a body with `exhausted: true`). Invalid cursors and malformed continuation are failures.
- Never claim a historical interface the upstream does not support. IPMA currently has no arbitrary historical walk.

## Product rules

- `ProductBuild` describes source meaning, not storage policy. It is discriminated as `kind: record|series` and declares a stable feed-local `productKey`, suggested initial public slug, `updateMode`, and completeness. It must not carry `retainChanges`, `replaceCurrent`, or retention directives.
- Whether a product keeps history is the example policy's decision, per product: under `historyMode: "changes"`, list in `collection.withoutHistory` the product keys of things that move rather than change (vehicle positions) and of copies of values another product of the feed already records. Everything else keeps every change.
- Use `authoritative-snapshot` only when omission is authoritative across the declared scope: a complete authoritative snapshot retracts what it leaves out. Use `partial-snapshot`, `delta`, or `source-window` otherwise. Source-window expiry is not deletion.
- Use stable provider IDs when available. If identity is provisional, document that uncertainty rather than fuzzy-matching universally.
- Include event time, validity, source publication time, sequence, units, and dimensions when the source provides them.
- Complete snapshots may be empty. Partial snapshots must be declared partial so omission cannot become deletion.
- Publish each value once. A feed's products must not restate the same values in another shape: a statistical indicator is one series product, not a table plus a series of the same numbers; a list of places is one table. Every duplicate doubles history rows, stored chunks and catalog entries.
- A series next to a table is allowed only when it carries values the table does not, such as a count, a median or a total per period (GBFS fleet counts, DGEG municipal medians, Carris active vehicles).
- Never infer measures from columns that merely look numeric: phone and fax numbers, codes, identifiers and parts of dates are not measurements. Series come from the source's own semantics (JSON-stat values, a documented measure) or from explicit configuration, such as Opendatasoft's `series` list of field names.
- Bump the normalizer version whenever the set of products or their meaning changes. The next collection then ignores the old checkpoint, and the kernel retires products the feed no longer declares.
- Changing a feed kind's description or semantics (for example `defaultProductRole`) changes the resolved feed. The Registry re-resolves every feed daily and whenever a gatekeeper's examples or feed kinds change, a few feeds per alarm, so existing feeds pick the change up by themselves; there is nothing to re-bootstrap or resume.
- Preserve deterministic pure normalizers and fixture tests.

## Register and test

A new topic Worker means a new package under `packages/gatekeeper-<topic>/`; `pnpm packages:sync` then regenerates the root scripts and the kernel's `GATEKEEPER_*` service bindings, and `tests/packages-sync.test.ts` fails when the checked-in files drift from the generator. Generate types with the package's Wrangler config. `pnpm dev -- <topic>` runs the kernel with that Worker alone; the Gatekeepers that are not running log `gatekeeper_unavailable` and their feeds are left alone.

Tests must cover:

- valid/invalid config and allowlisted hosts;
- upstream errors, malformed source data, and source byte caps;
- conditional requests and compound-source correctness;
- resolution identity, typed outcomes, normalized framing and counts, maximum row/frame/output sizes, and missing completion;
- streaming normalizers fed in small and 1-byte chunks, with bounded memory;
- live and historical modes where supported;
- explicit exhaustion and cursor progress;
- representative large-format expansion; and
- deterministic normalization independent of acquisition clocks.

Run the checks one at a time: `pnpm lint`, `pnpm types`, `pnpm types:check`, `pnpm typecheck`, `pnpm exec vitest run --maxWorkers=2`, `pnpm deploy:dry-run`. Collect a new example from its real source once with `LIVE_EXAMPLES=<slug> pnpm exec vitest run tests/live-examples.test.ts --maxWorkers=1`. Do not deploy or provision resources unless the owner explicitly asks for it.

A feed kind declares only what the platform reads: `semantics.domainSubject`, `semantics.defaultProductRole`, and `history.earliest` when the source states one. Everything else about how a feed behaves is its policy's business, not a label on the kind.

## Review order

1. data exposure or outbound-host mistakes;
2. original bytes crossing the RPC boundary;
3. unbounded source or normalized output;
4. incorrect checkpoint/no-op behavior, especially compound feeds;
5. incomplete history/exhaustion semantics;
6. lossy or misleading normalization/identity;
7. RPC serialization and Worker lifecycle mistakes;
8. missing tests and documentation drift.

## Completion criteria

A library is complete only when it holds all the parsing, exports exactly one examples array whose configurations name it in `source`, is bounded in both source and expanded forms, honest about coverage and identity, idempotent under retry through stable kernel batch IDs, and covered by fixture tests. A topic Worker is complete only when it is separately deployable, private-RPC only, normalized-stream only, declares exactly the vars and secrets its libraries need, is represented in generated bindings, and passes a dry-run deployment.
