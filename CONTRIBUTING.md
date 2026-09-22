# Contributing

open-data.pt collects Portuguese public data and publishes it as cacheable JSON. Everything it collects is described by an **example feed**: a slug, a title, a source configuration and a policy. Add one and the platform installs it, collects it, keeps its history and gives it a product page. Pull requests welcome; deploys and secrets are the owner's.

The long-form documentation is in [`docs/`](docs/): [Architecture](docs/architecture.md),
[Libraries](docs/libraries.md), [Public API](docs/api.md), [Running it](docs/development.md), and
per-source notes under [`docs/publishers/`](docs/publishers/) and [`docs/feeds/`](docs/feeds/).
[`CONTEXT.md`](CONTEXT.md) defines the words used here.

## Where code lives

```
apps/gatekeeper/src/
  publishers/<publisher>/   one folder per publisher: everything about them in one place
    index.ts                who they are (name, site, whether we may republish them)
    logo.svg | logo.png     their mark, when we have one
    datasets/<name>.ts      each dataset: what it is, its terms and topics, and the feeds that read it
    <library>/              their own API's library, when they have one (carris, ipma, snirh, …)
  formats/<format>/         the standards many publishers share: arcgis  ckan  gbfs  gtfs  myinfo  ngsi
                            ogc  opendatasoft  udata  wfs
  catalog/                  the licences and topics every dataset names, and the folder index
  libraries.ts              the libraries the Worker carries
apps/kernel/                storage, history and the API; serves the site
apps/site/                  the site, built into the kernel's static assets
packages/contract/          what the two Workers say to each other: the RPC (the catalog included),
                            the normalized stream, JSON helpers and validation
packages/api/               what the API sends: the wire shapes the kernel builds and the site reads
packages/lisbon/            Europe/Lisbon wall-clock arithmetic
```

1. **A library per format.** Anything with a standard — GTFS, GBFS, ArcGIS, CKAN, Opendatasoft, uData, OGC API Features, WFS — is parsed once, under `formats/`. A Worker never contains parsing.
2. **A library per bespoke source, in its publisher's folder:** `publishers/carris-metropolitana/carris/`, `publishers/apa/snirh/`, `publishers/ripe-ncc/ripestat/`. A source that carries many publishers — MYINFO, one platform behind a dozen bus operators — is a format.
3. **One Worker, every library.** A library is how the data is read, never what it is about or who publishes it: topics overlap — a city Wi-Fi map is `cities` and `telecom` — and a publisher may be read two ways, so neither is a code boundary. Each library's `deployment.ts` declares its name, its vars with their values, and any secrets, buckets and CPU limit; `libraries.ts` lists the libraries the Worker carries, every one of them. Topics (`TOPICS` in `apps/gatekeeper/src/catalog/topics.ts`) and the publisher are labels on a dataset, shown on the site.
4. **Feed slugs never change.** A feed's ID derives from its slug, so a feed keeps its history wherever it runs. Renaming a slug throws that history away.

A library exports its feed-kind table, `validate<Name>FeedConfig`, `collect<Name>Feed`, its transformer, its examples array, `<name>Collector(options)`, and `<NAME>_DEPLOYMENT` from `deployment.ts` — what the Worker needs to carry it. Every example configuration carries `source: "<library>"`, which is what routes it inside the Worker; the library never sees that key.

## The kinds of contribution

### A new dataset from a source we already read

One file in the publisher's folder: `apps/gatekeeper/src/publishers/<publisher>/datasets/<name>.ts`.
Then `pnpm catalog`, which adds it to the index the Worker imports. Nothing else.

```ts
// apps/gatekeeper/src/publishers/cm-porto/datasets/bicycle-racks.ts
import type { DatasetDefinition } from "../../../catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Porto bicycle racks",
  description: "Public bicycle parking published by Câmara Municipal do Porto.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal do Porto via dadosabertos.cm-porto.pt",
  topics: ["cities", "mobility"],
  feeds: [
    {
      slug: "porto-bicycle-racks-feed", // never changes once merged
      config: { source: "ckan", host: "opendata.porto.digital", dataset: "estacionamento-bicicletas" },
      policy: { name: "…", version: 1, collection: { …cadence, timeout, maxBytes, historyMode } },
      staleAfterSeconds: 172_800,
    },
  ],
};
```

The dataset's key is its publisher's folder and its file: `cm-porto-bicycle-racks`. It never
changes once merged — it addresses the dataset's page — so neither does the file's name.

A **dataset** is one publisher's body of data; a **feed** is one way a part of it is read. Two feeds
belong to the same dataset when they describe the same things, by the same identifiers, under the
same terms: Carris's stops, vehicles, alerts and GTFS are one dataset, while IPMA's forecasts and
its earthquakes share nothing and are two. A feed of a dataset read by several feeds says what it is
within it (`title`, `description`); a feed that is the whole of its dataset says nothing the dataset
already says, and a test holds both.

`source` decides which library reads the feed. `licence` is a key of `LICENCES`
(`apps/gatekeeper/src/catalog/licences.ts`): the terms the publisher states, or `source-terms` when
they state none. `topics` are keys of `TOPICS`, as many as fit. A licence or topic the vocabulary
lacks is one new entry there, and a test rejects one nothing uses.

### A new publisher

A folder named for their key, `apps/gatekeeper/src/publishers/<publisher>/`, with an `index.ts`:

```ts
import type { PublisherDefinition } from "../../catalog/define";

export const PUBLISHER: PublisherDefinition = {
  name: "Câmara Municipal do Porto",
  url: "https://www.cm-porto.pt/",
  logo: "svg",
};
```

and at least one dataset. Who made the data, never the portal it was read from: dados.gov.pt
carries ten publishers and is none of them. Their mark is optional: `logo.svg` or `logo.png` beside
the `index.ts`, with `logo` naming its extension; [the publishers README](apps/gatekeeper/src/publishers/README.md)
says where a usable one comes from and what shape it has to be. A publisher without one is shown
their initials, so a missing logo never looks like a broken page. A publisher we may not republish
yet carries `enabled: false` and a comment saying what we are waiting for: their folder and code
stay, and nothing of theirs is polled or served.

### A new source on a format we already read

The publisher's folder and the dataset file above, and nothing in the format. A format fetches
only the hosts its publishers' feeds name: the Worker gathers them from the folders, so the host in
the feed's `config` is the allowlist entry.

If the format cannot read their data as it is — a file laid out in a way only this publisher lays
it out — the translator for it goes in their folder too, in `transformers.ts`:

```ts
// apps/gatekeeper/src/publishers/cm-cadaval/transformers.ts
export const TRANSFORMERS: PublisherTransformers = {
  udata: { "municipal-waste": new MunicipalWasteTransformer() },
};
```

and the feed names it with `transformer: "municipal-waste"` in its `config`.

### A new bespoke source

A library folder inside its publisher's, `apps/gatekeeper/src/publishers/<publisher>/<name>/`: `<name>.ts` (feed kinds, validation, fetching), `transform.ts` (bytes to products), `collector.ts` (the factory), `deployment.ts` (its `<NAME>_API_ORIGIN` var and anything else the Worker must give it), `index.ts` (the barrel), and one line in `libraries.ts`. Its feeds go in the publisher's dataset files, like any other. Fixture tests under `tests/` with saved source responses — no network in unit tests, and no module mocking.

### A new format

The same, under `formats/<format>/`, taking the hosts its publishers' feeds name (`publishers.hosts`, the second argument of its deployment's `library`) rather than a fixed origin.

## What a Worker sends

5. **Only what the kernel reads.** A field with one possible value is not a field.
6. **Date rows by the source's clock,** never by when we polled. A row stamped with the poll time is a new revision, a lake row and a rewritten window on every collection.
7. **Publish each value once.** No table and series of the same numbers. A series beside a table is allowed only when it carries something the table does not — a count, a median, a total per period.
8. **History is per product,** not per feed: positions and copies of another product's values keep none (`collection.withoutHistory`).

## Running one library locally

```bash
pnpm install
pnpm types
pnpm dev ckan               # the kernel and the Gatekeeper carrying CKAN alone
pnpm dev                    # five libraries that fill the pages: IPMA, DGEG, OMIE, Carris, USGS
pnpm dev all                # every library, every source
```

The Worker carries only the libraries you name, so the Registry installs only their feeds and polls only their sources, and no local feed runs more often than every half hour. The site is on <http://localhost:8787>. [`docs/development.md`](docs/development.md) says how the selection reaches the Worker, which is less obvious than it looks.

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

## Documenting what you added

Code comments carry the reasoning next to the line it explains, and that is usually enough. Write a
page under [`docs/publishers/`](docs/publishers/) when reading a publisher's data takes knowledge a
reader of `examples.ts` would not guess — a credential, a proxy, a permission, a habit of the source —
and one under [`docs/feeds/`](docs/feeds/) when a single feed's configuration needs explaining. Both
folders have a README saying what a page holds and how to list it.
