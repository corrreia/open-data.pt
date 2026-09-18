# Contributing

open-data.pt collects Portuguese public data and publishes it as cacheable JSON. Everything it collects is described by an **example feed**: a slug, a title, a source configuration and a policy. Add one and the platform installs it, collects it, keeps its history and gives it a product page. Pull requests welcome; deploys and secrets are the owner's.

## Where code lives

```
packages/gatekeeper-shared/src/
  formats/<format>/     arcgis  ckan  opendatasoft  gtfs  gbfs  udata  ogc
  sources/<name>/       carris  metrolisboa  ipma  dgeg  ine  ren  omie  bpstat  eurostat  parliament  myinfo  ioda
                        ripeatlas  ripestat  peeringdb
packages/gatekeeper-<library>/  generated, one per library:
                        arcgis  bpstat  carris  ckan  dgeg  eurostat  gbfs  gtfs  ine  ipma
                        metrolisboa  ogc  omie  opendatasoft  parliament  ren  udata
apps/kernel/            storage, history, the API and the site
```

1. **A library per format.** Anything with a standard — GTFS, GBFS, ArcGIS, CKAN, Opendatasoft, uData, OGC API Features — is parsed once, under `formats/`. A Worker never contains parsing.
2. **A library per bespoke source,** under `sources/`: Carris, Metro Lisboa, IPMA, DGEG, INE, REN, OMIE, BPstat, Eurostat, Parliament, MYINFO, IODA, RIPE Atlas, RIPEstat, PeeringDB.
3. **One Worker per library, generated.** A Worker is how the data is read, never what it is about or who publishes it: topics overlap — a city Wi-Fi map is `cities` and `telecom` — so they cannot place a Worker, and there is no per-publisher Worker either. Each library's `worker.ts` declares its name, vars, secrets, buckets and CPU limit, and `pnpm packages:sync` writes `packages/gatekeeper-<library>/` for every library with examples and no publication hold. Nobody edits a Worker package. Topics (`TOPICS` in `packages/gatekeeper-shared/src/topics.ts`) and the publisher are labels on a feed, shown on the site; neither is a code boundary.
4. **Feed slugs never change.** A feed's ID derives from its slug, so a feed keeps its history wherever it runs. Renaming a slug throws that history away.

A library exports its feed-kind table, `validate<Name>FeedConfig`, `collect<Name>Feed`, its transformer, its examples array, `<name>Collector(options)`, and `<NAME>_DEPLOYMENT` from `worker.ts` — what a Worker needs to carry it. Every example configuration carries `source: "<library>"`, which is what routes it inside its Worker; the library never sees that key.

## The four kinds of contribution

### A new dataset from a source we already read

One entry in that library's `examples.ts`. Nothing else.

```ts
{
  slug: "porto-bicycle-racks-feed",          // never changes once merged
  title: "Porto bicycle racks",
  description: "Public bicycle parking published by Câmara Municipal do Porto.",
  config: { source: "ckan", host: "opendata.porto.digital", dataset: "estacionamento-bicicletas" },
  policy: { name: "…", version: 1, collection: { …cadence, timeout, maxBytes, historyMode }, serving: { licence, attribution } },
  staleAfterSeconds: 172_800,
  publisher: "Câmara Municipal do Porto",
  topics: ["cities", "mobility"],
}
```

`source` decides which Worker runs it; `topics` are browsing tags, any number of them, each a key of `TOPICS`.

### A new source on a format we already read

The example above, plus its hostname in the library's allowlist var (`CKAN_ALLOWED_HOSTS`, `ARCGIS_ALLOWED_HOSTS`, …) in that library's `worker.ts`, then `pnpm packages:sync`.

### A new bespoke source

A directory under `packages/gatekeeper-shared/src/sources/<name>/`: `<name>.ts` (feed kinds, validation, fetching), `transform.ts` (bytes to products), `examples.ts`, `collector.ts` (the factory), `worker.ts` (its `<NAME>_API_ORIGIN` var and anything else a Worker must give it), `index.ts` (the barrel). Then `pnpm packages:sync`, which generates the library's own Worker, followed by `pnpm install` and `pnpm types`. Fixture tests under `tests/` with saved source responses — no network in unit tests, and no module mocking.

### A new format

The same, under `formats/<format>/`, with an allowlist var rather than a fixed origin.

## What a Worker sends

5. **Only what the kernel reads.** A field with one possible value is not a field.
6. **Date rows by the source's clock,** never by when we polled. A row stamped with the poll time is a new revision, a lake row and a rewritten window on every collection.
7. **Publish each value once.** No table and series of the same numbers. A series beside a table is allowed only when it carries something the table does not — a count, a median, a total per period.
8. **History is per product,** not per feed: positions and copies of another product's values keep none (`collection.withoutHistory`).

## Running one Worker locally

```bash
pnpm install
pnpm types
pnpm dev -- ckan            # the kernel and one Gatekeeper
pnpm dev                    # the kernel and every Worker
```

A Gatekeeper the kernel is bound to but that is not running is not an error. The Registry's example sync logs `gatekeeper_unavailable` for it, installs the feeds of the Workers that answered, and keeps the missing one's feeds rather than retiring them. So a single-Worker session gives you that Worker's feeds and leaves everything else alone.

## Testing against the real source

Unit tests use fixtures. Before a pull request, collect your example from the source it actually names:

```bash
LIVE_EXAMPLES=porto-bicycle-racks-feed pnpm exec vitest run tests/live-examples.test.ts --maxWorkers=1
```

It resolves and collects exactly the way the deployed Worker does, and reads the result through the kernel's own frame validation. `LIVE_EXAMPLES=all` runs every example; be kind to the sources.

## Before you open a pull request

```bash
pnpm lint
pnpm format:check
pnpm types
pnpm types:check
pnpm typecheck
pnpm exec vitest run --maxWorkers=2
pnpm deploy:dry-run
```

`pnpm packages:sync` regenerates every library Worker, the root scripts and the kernel's service bindings; a test fails when the checked-in files drift from it. After it creates a Worker, run `pnpm install` and `pnpm types`.

`pnpm format` formats with Oxfmt; CI runs every check above on each pull request. The repository lints with vendored anti-slop rules: no runtime `typeof`, no widening anonymous types, a `SAFETY:` comment before every type assertion, no module mocking. Match the surrounding test style.

## What is not yours to do

Deploys, secrets and Cloudflare resources are the owner's. Do not run `pnpm deploy`, `wrangler deploy`, `wrangler secret put`, or `infra/lake/provision.sh`. `pnpm deploy:dry-run` proves the bundle without touching anything.
