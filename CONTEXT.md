# Domain language

## Gatekeeper

One trusted Worker per library — `arcgis`, `ckan`, `gtfs`, `ine`, `parliament`, … — named for how the data is read, never for what it is about or who publishes it. It validates configuration, accesses allowlisted upstream resources, parses and normalizes source data, and returns a bounded versioned normalized stream over private RPC. It owns source identity, clocks, validators, pagination, coverage, and source-supported history. It owns no canonical storage or publication state.

A Worker is wiring, and generated: one library, the vars, secrets and buckets that library declares, and its example feeds. Format and source code are shared libraries; the Worker is only their deployment unit. Topics and the publisher are labels on a feed, not code boundaries: topics overlap, so a Worker cannot follow them.

## Library

The code that reads one thing, under `packages/gatekeeper-shared/src`. A format library under `formats/` parses anything with a standard (ArcGIS, CKAN, Opendatasoft, GTFS, GBFS, uData, OGC API Features); a source library under `sources/` reads one bespoke API (Carris, Metro Lisboa, IPMA, DGEG, INE, REN, OMIE, BPstat, Eurostat, Parliament, IODA, RIPEstat, PeeringDB). Each exports its feed-kind table, its validator, its collect function, its transformer, its examples array, a collector factory, and a deployment declaration (`worker.ts`) saying what a Worker must give it. A feed's configuration names its library in `source`; that key routes the feed inside its Worker, and the library never sees it.

## Source

An external system that publishes data, such as dados.gov.pt or the Carris Metropolitana API.

## Source fetch

What an adapter hands the shared collector: a typed body with provenance, completeness, validators and history progress, or an explicit not-modified or exhausted outcome. No HTTP header side-channel.

## Feed kind

One capability a Gatekeeper declares: what its facts are about, what role its products play by default, and how far back its history reaches. How often it is collected, and under what licence it is served, are its policy's business.

## Feed

One repeatable collection definition: Gatekeeper, canonical resolved source configuration/resource identity, feed semantics, policy, and semantic feed epoch. Administrative edits do not rotate the epoch.

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
