# Domain language

The words this repository uses, and what each one means here. How they fit together is in
[`docs/`](docs/): [Architecture](docs/architecture.md) for the path a source takes,
[Libraries](docs/libraries.md) for what is read and how it is grouped, and
[Public API](docs/api.md) for what comes out the other end.

## Gatekeeper

The one trusted Worker that carries every library — `arcgis`, `ckan`, `gtfs`, `ine`, `parliament`, … — reached over private RPC. It validates configuration, accesses allowlisted upstream resources, parses and normalizes source data, and returns a bounded versioned normalized stream. It owns source identity, clocks, validators, pagination, coverage, and source-supported history. It owns no canonical storage or publication state.

The Worker is wiring: every listed library, built from the vars each declares and the secrets and buckets the Worker binds, and every library's example feeds. Format and source code are libraries; the Worker is only their deployment unit. A feed's `source` key names its library, and that is what routes it. Topics and the publisher are labels on a feed, not code boundaries: topics overlap, and a publisher may be read through more than one library.

## Library

The code that reads one thing, under `packages/gatekeeper-shared/src`. A format library under `formats/` parses anything with a standard (ArcGIS, CKAN, Opendatasoft, GTFS, GBFS, uData, OGC API Features, WFS); a source library under `sources/` reads one bespoke API (Carris, Metro Lisboa, IPMA, DGEG, INE, REN, OMIE, BPstat, Eurostat, Parliament, MYINFO, NASA FIRMS, NASA POWER, USGS, ANEPC, IODA, RIPE Atlas, RIPEstat, PeeringDB, SNIT). Each exports its feed-kind table, its validator, its collect function, its transformer, its examples array, a collector factory, and a deployment declaration (`deployment.ts`) saying what the Worker must give it. `libraries.ts` lists the ones the Worker carries; a library under a publication hold is not listed. A feed's configuration names its library in `source`; that key routes the feed inside the Worker, and the library never sees it.

## Source

An external system that publishes data, such as dados.gov.pt or the Carris Metropolitana API.

## Source fetch

What an adapter hands the shared collector: a typed body with provenance, completeness, validators and history progress, or an explicit not-modified or exhausted outcome. No HTTP header side-channel.

## Feed kind

One capability a library declares: what its facts are about, what role its products play by default, and how far back its history reaches. How often it is collected, and under what licence it is served, are its policy's business.

## Feed

One repeatable collection definition: library, canonical resolved source configuration/resource identity, feed semantics, policy, and semantic feed epoch. Administrative edits do not rotate the epoch.

## Publisher

Where the data comes from: the body that stands behind it, one key of `PUBLISHERS` per institution or operator.

A site that only carries what others put on it is a shelf, not a publisher. dados.gov.pt holds ten publishers and is none of them, and the Card4B portal holds a dozen bus operators' timetables without being any of them: name whoever put the data there.

A body that curates what it serves and answers for it is the publisher, even where it did not draw every line itself. The Carta do Regime de Uso do Solo is DGT's, though it is each municipality's plan that DGT redrew into a national classification — the layer names both roles in separate columns, `Autor` and `Fonte`, and the publisher is the author. SNS Transparência is the health service publishing its own data, though ACSS, INEM, INSA and nine more each produced a part of it.

Carris Metropolitana is one publisher read through two libraries. A feed names its publisher by key, and the API serves it expanded (`id`, `name`, `url`).

## Licence

The terms a product is served under, one key of `LICENCES` per set of terms, as the publisher states them: a licence with a canonical text carries its URL, a publisher's own terms carry their name, and `source-terms` says the publisher states none. A policy names its licence by key; the API serves it expanded (`id`, `name`, optional canonical `url`, and a description), and the site groups every dataset under it.

## Policy

Versioned limits and rules for collection, history mode (`changes` or `latest`) and the products it leaves out, licence, and attribution. A product keeps history when its policy keeps changes and does not name it in `withoutHistory`; nothing else decides it. Retry counts and the history backlog budget are the kernel's, the same for every feed.

## Collection

One logical live or historical request, run by a Workflow instance. The kernel supplies one ID, one resolved configuration/resource identity, a compatible checkpoint, observation time, explicit limits, a deadline, and a mode. Outcomes are typed unchanged, batch byte stream, history exhaustion, or failure.

## Normalized batch

A complete byte-oriented `open-data-normalized/4` NDJSON stream: a header with protocol, normalizer, stable feed-local product keys, product declarations, provenance, the source body's completeness and candidate checkpoint; product-keyed record and point frames; and a mandatory completion frame with counts, quality, and values only known at the end (inferred schema, watermark, downgraded completeness). A missing or invalid completion frame is never accepted.

## Product

A cleaned public view generated from one feed. A stable feed-local product key identifies it internally; its public slug never changes once bound. A product has one role: reference data, current state, event log, time series, or summary.

## Entity index

For a record product larger than 20,000 rows, the FeedRunner's SQLite table of each entity's semantic hash and served JSON. Rows are compared against it in chunks; only changes are written. Smaller products are compared in memory against the rows they currently serve.

## Chunk list

The serving form of a current record product: the ordered list of immutable, content-addressed chunks of rows ordered by entity key, with boundaries chosen by key hashes. It is part of the product's index entry; the Registry stores it apart from the entry so that only a single-product read returns it. An unchanged chunk keeps its key and is never uploaded again. Only the selected version is served; what the previous version referenced and the new one does not is deleted an hour later.

## Revision

A meaningful create, update, delete, correction, retraction, or time-series correction with a stable retry-safe identity. Payload, value, unit, dimensions, validity, operation, and the record's own source clocks participate in semantic comparison. Input order, a batch-level publication timestamp, and wrapper-only source changes do not create revisions.

## History outbox

Committed revisions waiting for Pipelines, grouped into blobs of about one megabyte in the FeedRunner's SQLite. Draining it is retried until acknowledged; its size is the feed's history backlog, and new collections pause above the policy budget.

## Checkpoint

A v2 kernel envelope binding resource key, canonical configuration hash, semantic feed epoch, and normalizer identity/version around at most 16 KiB of finite Gatekeeper-owned JSON state. It advances only in the same transaction that commits the batch's changes and history.

## Coverage

What a public history response states about itself: when the lake begins, how far a historical walk has reached, and whether that walk finished. Serving windows and the oldest cached point are not proof of lake completeness.

## Runner

The FeedRunner Durable Object that owns one feed's schedule, checkpoint, product entries, entity index, staged changes, history outbox, acquisitions, and terminal status. It starts Workflow executors and answers their short calls; it never waits on a source itself. It wakes only when something is due: a run, a retry, a cooldown's end, the watchdog, undelivered history, or superseded objects to delete.

## Registry

The small Durable Object that stores feed definitions and policies, slug ownership, and the atomically selected product index with each record product's chunk list, and mirrors each runner's status and recent acquisitions. A product read is one call to it: staleness, whether the public may read it, whether it serves history, and its cadence are computed then. Its alarms are the example sync and the daily lake delivery audit.

## Lake

The durable append history of meaningful record revisions and series-point revisions, written through Pipelines into Iceberg tables in R2 Data Catalog, partitioned by ingest day, and read only through typed bounded API handlers.

## Kernel

The Worker, Workflow and Durable Objects that validate normalized streams, detect semantic changes, commit history, select serving versions, schedule work, and expose cacheable typed APIs. It never receives an original source body and contains no source-specific parser.

## Usage

How the site, the API and the MCP server are used: one Workers Analytics Engine data point per request the Kernel answers, with its surface (web, api, mcp, mcp-read, docs, discovery), route template, the product or other subject it names, the kind and name of client its User-Agent gives, country, referrer, status and cache outcome. No IP address, cookie or visitor identifier. Analytics Engine keeps it for three months; `/api/analytics` reads the aggregate for the `/analytics/` page. It is not history and never enters the Lake.

## Documentation

What a reader needs that the code does not say. Reasoning about one line lives in a comment beside it;
`docs/` holds what spans files: [`architecture.md`](docs/architecture.md),
[`libraries.md`](docs/libraries.md), [`api.md`](docs/api.md) and [`development.md`](docs/development.md).
A page under [`docs/publishers/`](docs/publishers/) or [`docs/feeds/`](docs/feeds/) is written only when
reading a source takes knowledge a reader of `examples.ts` would not guess — a credential, a proxy, a
permission, a cap, a habit of the source. Most publishers and feeds need none, and a page that only
repeats the configuration is a page that will go stale.

---

## Further reading

- [`docs/architecture.md`](docs/architecture.md) — the Gatekeeper, collection, storage, history and backfill
- [`docs/libraries.md`](docs/libraries.md) — every library, the publication holds, and the three catalog vocabularies
- [`docs/api.md`](docs/api.md) — the endpoints these terms are visible through
- [`docs/publishers/`](docs/publishers/) and [`docs/feeds/`](docs/feeds/) — notes on individual publishers and feeds
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to add one of these things
