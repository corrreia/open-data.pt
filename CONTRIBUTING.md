# Contributing

open-data.pt collects Portuguese public data and publishes it as cacheable JSON. Everything it collects is described by an **example feed**: a slug, a title, a source configuration and a policy. Add one and the platform installs it, collects it, keeps its history and gives it a product page. Pull requests welcome; deploys and secrets are the owner's.

## Where code lives

```
packages/gatekeeper-shared/src/
  formats/<format>/     arcgis  ckan  opendatasoft  gtfs  gbfs  udata  ogc
  sources/<name>/       carris  metrolisboa  ipma  dgeg  ine  ren  omie  bpstat  eurostat  parliament  myinfo  ioda
                        ripeatlas  ripestat  peeringdb
  libraries.ts          the libraries the Gatekeeper Worker carries
packages/gatekeeper/    the Gatekeeper Worker: every listed library behind one private RPC binding
apps/kernel/            storage, history, the API and the site
```

1. **A library per format.** Anything with a standard — GTFS, GBFS, ArcGIS, CKAN, Opendatasoft, uData, OGC API Features — is parsed once, under `formats/`. A Worker never contains parsing.
2. **A library per bespoke source,** under `sources/`: Carris, Metro Lisboa, IPMA, DGEG, INE, REN, OMIE, BPstat, Eurostat, Parliament, MYINFO, IODA, RIPE Atlas, RIPEstat, PeeringDB.
3. **One Worker, every library.** A library is how the data is read, never what it is about or who publishes it: topics overlap — a city Wi-Fi map is `cities` and `telecom` — and a publisher may be read two ways, so neither is a code boundary. Each library's `worker.ts` declares its name, its vars with their values, and any secrets, buckets and CPU limit; `libraries.ts` lists the libraries the Worker carries, and a library under a publication hold is not listed. Topics (`TOPICS` in `packages/gatekeeper-shared/src/topics.ts`) and the publisher are labels on a feed, shown on the site.
4. **Feed slugs never change.** A feed's ID derives from its slug, so a feed keeps its history wherever it runs. Renaming a slug throws that history away.

A library exports its feed-kind table, `validate<Name>FeedConfig`, `collect<Name>Feed`, its transformer, its examples array, `<name>Collector(options)`, and `<NAME>_DEPLOYMENT` from `worker.ts` — what the Worker needs to carry it. Every example configuration carries `source: "<library>"`, which is what routes it inside the Worker; the library never sees that key.

## The four kinds of contribution

### A new dataset from a source we already read

One entry in that library's `examples.ts`. Nothing else.

```ts
{
  slug: "porto-bicycle-racks-feed",          // never changes once merged
  title: "Porto bicycle racks",
  description: "Public bicycle parking published by Câmara Municipal do Porto.",
  config: { source: "ckan", host: "opendata.porto.digital", dataset: "estacionamento-bicicletas" },
  policy: { name: "…", version: 1, collection: { …cadence, timeout, maxBytes, historyMode }, serving: { licence: "cc0-1.0", attribution: "Câmara Municipal do Porto via dadosabertos.cm-porto.pt" } },
  staleAfterSeconds: 172_800,
  publisher: "cm-porto",
  topics: ["cities", "mobility"],
}
```

`source` decides which library reads it. The rest are keys of the three catalog vocabularies in `packages/gatekeeper-shared/src/`: `topics` are browsing tags, any number of them, each a key of `TOPICS`; `publisher` is a key of `PUBLISHERS`, who made the data, never the portal it was read from; `licence` is a key of `LICENCES`, the terms the publisher states, or `source-terms` when it states none. A publisher or licence the vocabulary lacks is one new entry there — name, and its site or licence text when there is one — and a test rejects a key outside the list and an entry no example uses.

### A new source on a format we already read

The example above, plus its hostname in the library's allowlist var (`CKAN_ALLOWED_HOSTS`, `ARCGIS_ALLOWED_HOSTS`, …) in that library's `worker.ts`.

### A new bespoke source

A directory under `packages/gatekeeper-shared/src/sources/<name>/`: `<name>.ts` (feed kinds, validation, fetching), `transform.ts` (bytes to products), `examples.ts`, `collector.ts` (the factory), `worker.ts` (its `<NAME>_API_ORIGIN` var and anything else the Worker must give it), `index.ts` (the barrel), and one line in `libraries.ts`. Fixture tests under `tests/` with saved source responses — no network in unit tests, and no module mocking.

### A new format

The same, under `formats/<format>/`, with an allowlist var rather than a fixed origin.

## What a Worker sends

5. **Only what the kernel reads.** A field with one possible value is not a field.
6. **Date rows by the source's clock,** never by when we polled. A row stamped with the poll time is a new revision, a lake row and a rewritten window on every collection.
7. **Publish each value once.** No table and series of the same numbers. A series beside a table is allowed only when it carries something the table does not — a count, a median, a total per period.
8. **History is per product,** not per feed: positions and copies of another product's values keep none (`collection.withoutHistory`).

## Running one library locally

```bash
pnpm install
pnpm types
pnpm dev -- ckan            # the kernel and the Gatekeeper carrying CKAN alone
pnpm dev                    # carrying every library
```

The selection goes to `packages/gatekeeper/.dev.vars` as `GATEKEEPER_LIBRARIES`; the Worker carries only those libraries, so the Registry installs only their feeds and polls only their sources.

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

`pnpm format` formats with Oxfmt; CI runs every check above on each pull request. The repository lints with vendored anti-slop rules: no runtime `typeof`, no widening anonymous types, a `SAFETY:` comment before every type assertion, no module mocking. Match the surrounding test style.

## What is not yours to do

Deploys, secrets and Cloudflare resources are the owner's. Do not run `pnpm deploy`, `wrangler deploy`, `wrangler secret put`, or `infra/lake/provision.sh`. `pnpm deploy:dry-run` proves the bundle without touching anything.
