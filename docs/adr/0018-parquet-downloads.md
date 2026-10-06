# 0018. Parquet downloads of current products, written on first request

- Status: proposed
- Date: 2026-10-06
- Extends: 0017, which limited the public API to data, feeds and runs, and discovery (its file did
  not survive the history squash of 2026-09-15; this is the first ADR kept in `docs/adr/`). A Parquet
  file is data — the same rows `/records/all` serves — so it is inside that scope.

## Context

Analysts want whole datasets in the format their tools read natively — DuckDB, pandas, R, Spark,
QGIS — without paging the JSON API. `/records/all` streams every row as JSON, but a JSON array of
234,768 CRUS rows is 145 MB, untyped, and has to be parsed whole.

The platform must stay nearly free to run, and nothing about it may grow with collection frequency:
vehicle positions are collected every minute, and most products are never downloaded at all.

What the code already does, and what this decision builds on:

- A current record product is an ordered list of immutable, content-addressed chunks in R2
  (`open-data-pt-data`), listed on its index entry. Whatever an entry referenced and its successor
  does not is put in the runner's `garbage` table and deleted an hour later.
- There is no D1, no cron and no queue; periodic work runs on Durable Object alarms.
- The kernel runs under `limits.cpu_ms` 120,000 and the Workers 128 MB memory limit.
- The edge caches a product's current reads for a quarter of its cadence (15 s to 5 min).

## Decision

### The endpoint

`GET /api/products/{slug}.parquet`, named like `{slug}.geojson`: the product's current version as
one Apache Parquet file (`application/vnd.apache.parquet`). It takes no parameters, so every request
for a version is the same request and caches as one. It is in the strict rate-limit tier with
`.geojson` and `/records/all`; cache hits never count. A time series has no file — its current
state is a rolling window, and its long view is `/series/summary`. The DCAT catalog lists the file
as a `dcat:downloadURL` distribution of every record product, and the product page, the schema.org
Dataset markup, the Markdown page, the OpenAPI document, `/llms.txt` and the MCP guide name it.

### Columns

`id` (the entity key, required), then one column per field of the canonical schema in order, then
the row's clocks from `_time`: `_event_time`, `_valid_from`, `_valid_to`, `_source_published_at`,
`_source_sequence`, `_observed_at`.

| Field type                     | Parquet                                                      |
| ------------------------------ | ------------------------------------------------------------ |
| number, latitude, longitude    | DOUBLE                                                       |
| boolean                        | BOOLEAN                                                      |
| date                           | INT32 DATE (the date part as the source wrote it)            |
| datetime, and the clocks       | INT64 TIMESTAMP(MILLIS, UTC)                                 |
| category                       | UTF8 string, always dictionary-encoded                       |
| string, identifier, url, color | UTF8 string (dictionary-encoded when it pays, by the writer) |
| json                           | BYTE_ARRAY JSON                                              |
| geometry                       | BYTE_ARRAY WKB, described by GeoParquet 1.1 `geo` metadata   |

Schemas are inferred by each library from samples, so a value is not always of its field's type.
Numbers and flags written as text are converted; anything else that does not fit is left null and
counted per column in a `dropped_values` metadata entry, so a reader can see what the file could not
hold. The JSON API stays the lossless form.

**Geometry as WKB with GeoParquet 1.1 metadata, not GeoJSON text and not the Parquet `GEOMETRY`
logical type.** WKB is what every spatial reader expects in a Parquet file; GeoJSON text would be
read as a string everywhere. GeoParquet 1.1's `geo` key (encoding, geometry types, bounding box; the
CRS left out because GeoJSON is OGC:CRS84, GeoParquet's default) is read by GDAL and QGIS, GeoPandas,
and DuckDB — DuckDB 1.5 types such a column `GEOMETRY('OGC:CRS84')` without being asked. The newer
native `GEOMETRY` logical type (Parquet format 2.11) is left out: readers older than it may refuse
an annotation they do not know, and the `geo` key already says everything it would.

### Metadata

The footer's key-value metadata carries `product`, `title`, `description`, `version`, `updated_at`,
`licence`, `licence_id`, `licence_url`, `attribution`, `publisher`, `publisher_url`, `source` (the
page the feed last read) and `api`, so the terms travel with the file wherever it is copied.

### Written lazily, once per version, kept with the version

Nothing is written when a product is collected. The first request for a version writes the file into
R2; every later request, from any colo, reads it from there, and the edge keeps the response as long
as the product's other current reads. A minute-cadence product is therefore written at most once per
version, and only if someone asks — a version nobody downloads costs nothing.

The file's key is a digest of what it is made of: the layout version, the product version, the
schema, and the content-addressed chunk keys
(`serving/{feedId}/{slug}/parquet/{digest}.parquet`). Because the runner can compute it from the
index entry alone, `objectKeysOf` includes it: when a newer version supersedes an entry, the old
file goes into the `garbage` table with the old chunks and is deleted an hour later, exactly like
them. Deleting a file that was never written is a free no-op. A runner reset that reuses a version
number cannot find another version's file, because the chunk keys differ. When the file's layout
changes, `PARQUET_LAYOUT` is bumped and cleanup derives the key under every layout up to it, so a
file written under an older layout is still retired with its version rather than orphaned.

What the footer says about the product beyond its data — title, description, the licence's id, name
and URL, and the attribution — is not part of the key, since the runner does not know all of it; a
digest of it is stored as the object's custom metadata, and a file whose digest no longer matches is
written again under the same key.

Two simultaneous first requests may both write the file; the writes are identical and the second
overwrites the first. No lock is worth the extra Durable Object request.

### Writing within a request's limits

The writer is `hyparquet-writer` (MIT, pure JavaScript, no WASM, released 2026-09-22, one dependency:
the `hyparquet` reader the tests use), with its built-in Snappy compression. Bundled, the writer is
105 KiB (22 KiB gzipped); the kernel's dry-run upload is 2,572 KiB (489 KiB gzipped), far inside
the Worker size limit. The module is imported only by this endpoint, so no other request evaluates it.

A file is written a row group at a time: chunks are read one by one, a row group closes after eight
chunks (at most 16 MiB of JSON) or 65,536 rows, and after each row group the writer's buffer is
handed to an R2 multipart upload in uniform 8 MiB parts (R2 requires every part but the last to be
the same size; a file under one part is a single `put`). Memory is bounded by one row group, not by
the product.

Measured locally (Node 26 on this repository's development machine, the kernel's own code, real
production rows downloaded from `/records/all`, chunked as the kernel serves them):

| Product                         | Rows    | JSON    | Parquet | Row groups | CPU    | Peak heap |
| ------------------------------- | ------- | ------- | ------- | ---------- | ------ | --------- |
| `dgt-crus` (largest)            | 234,768 | 145 MB  | 4.5 MB  | 15         | 11.3 s | 94 MB\*   |
| `cascais-street-trees` (points) | 37,896  | 33 MB   | 1.8 MB  | 3          | 4.9 s  | 105 MB\*  |
| `base-procurement-notices-2026` | 23,610  | 27 MB   | 4.6 MB  | 2          | 3.8 s  | 109 MB\*  |
| `dgt-fototeca-index`            | 29,979  | 12.6 MB | 1.2 MB  | 2          | 3.7 s  | 93 MB\*   |

\* Heap sampled every 5 ms, garbage included, with the test runner's own 15–45 MB. Run again with
V8's old space capped at 64 MB, every product still wrote its file, CRUS peaking at 45 MB.

DuckDB 1.5 reads every one of these files back: the right types, the row counts, the metadata, and
the trees' geometry as `GEOMETRY('OGC:CRS84')`.

A product of more than 1,000,000 rows or 400 chunks (each at most 2 MiB) is refused with `413` and
a pointer to `/records/all`, before any chunk is read, instead of being cut off by the CPU limit.
That is over four times CRUS, the largest product today.

## History: not now, and why

Monthly or daily Parquet history per product, from the lake, was considered. Measured on
2026-10-06 against R2 SQL:

| Query                                                            | Rows                          | Scanned |
| ---------------------------------------------------------------- | ----------------------------- | ------- |
| One ingest day of `open_data.records`, all products, all columns | 32,605                        | 3.19 MB |
| One ingest day of `open_data.points`, all products               | 121,986 (100k read)           | 2.52 MB |
| September 2026, record revisions by product                      | top: 504,511 in one product   | 2.5 MB  |
| September 2026, point revisions by product                       | top: 5,992,472 in one product | 1.2 MB  |
| Whole lake                                                       | 5.2 M records, 24.7 M points  | —       |

R2 SQL would cost nothing: a daily pass over both tables is billed at the 10 MB minimum per query,
about 0.6 GB a month against 10 GB free. What it would cost is code and Worker time. The day's
answers are 27 MB (records) and over 35 MB (points) of JSON, which a Registry alarm would have to
page, split by product (about 400 products a day), encode, and store; months would need a second
pass to merge days, since one product's backfill month (5.99 M points) is far past what one request
can encode; and every file needs a listing, a retention rule and an endpoint. That is a second
summaries job, and a second copy of what the lake already keeps as Parquet.

The design, when it is wanted: piggy-back on the series-summaries fresh pass (one all-products query
per table per ingest day, already paged), write one Parquet file per product per ingest day under
`history/v1/{slug}/{YYYY-MM-DD}.parquet`, list them in the product's month blob that the summaries
job already keeps, and serve `GET /api/products/{slug}/history/{YYYY-MM-DD}.parquet` from R2 only.
Daily files keep every write inside one alarm's budget and need no monthly merge; DuckDB reads a
month as a glob of URLs.

## Consequences

- One more object per downloaded product version in `open-data-pt-data`, deleted with the version.
  CRUS's file is 3% of its chunks.
- The edge caches a whole file; DuckDB's and browsers' byte ranges are cut from it by the cache.
  A range asked of a cold cache is answered from R2 as `206` and not cached.
- A value the schema does not describe becomes null in the file; the JSON API remains exact.
- A product too large for one request gets no file until the limit is raised or the writer runs in
  a Workflow step instead of a request.
