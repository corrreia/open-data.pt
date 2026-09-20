# Public API

All endpoints live under `/api` on <https://open-data.pt>. No key, no account, no quota to ask for.
The generated reference is at [open-data.pt/docs](https://open-data.pt/docs) and the exact contract at
[`/openapi.json`](https://open-data.pt/openapi.json); this page is the map.

## Catalog and data

| Method | Path                                 | Purpose                                        |
| ------ | ------------------------------------ | ---------------------------------------------- |
| `GET`  | `/api/products`                      | Public product catalog                         |
| `GET`  | `/api/products/:slug`                | One product's metadata                         |
| `GET`  | `/api/products/:slug/records`        | Current records with cursor pagination         |
| `GET`  | `/api/products/:slug/records/all`    | Every current record in one streamed response  |
| `GET`  | `/api/products/:slug/series`         | Current bounded series window                  |
| `GET`  | `/api/products/:slug/changes`        | Recent bounded changes                         |
| `GET`  | `/api/products/:slug/series/changes` | Recent series corrections                      |
| `GET`  | `/api/products/:slug.geojson`        | Current geospatial records as streamed GeoJSON |
| `GET`  | `/api/catalog.dcat.json`             | DCAT 3 JSON-LD catalog                         |

## History

Durable history, from the lake. Every one of these requires a bounded UTC interval of at most 366
days, and answers with an opaque `nextCursor`, freshness and explicit coverage.

| Method | Path                                       | Purpose                                                                            |
| ------ | ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `GET`  | `/api/products/:slug/events`               | Applicable event revisions in a bounded interval (`from`, `to`, `knownAt`)         |
| `GET`  | `/api/products/:slug/changes/range`        | Durable changes in a bounded knowledge-time interval                               |
| `GET`  | `/api/products/:slug/series/range`         | Durable deduplicated series points; `knownAt` answers what was known then          |
| `GET`  | `/api/products/:slug/series/changes/range` | Series point revisions (new points and corrections) ingested in a bounded interval |

## Where the data comes from, and how it is going

| Method | Path                             | Purpose                                                                                |
| ------ | -------------------------------- | -------------------------------------------------------------------------------------- |
| `GET`  | `/api/feeds`, `/api/feeds/:id`   | Publisher, source, format, cadence and freshness of each dataset                       |
| `GET`  | `/api/acquisitions?feedId=&day=` | Collection runs, newest first, or every run of one UTC day                             |
| `GET`  | `/api/outages?days=`             | When each feed's live collection kept failing, and when the platform collected nothing |
| `GET`  | `/api/health`                    | One JSON status for uptime checks                                                      |

## Rules that apply to all of it

- The API is **read-only**: every other method answers `405`.
- `/records` accepts `where=field:value` (up to five) and, for located products,
  `bbox=minLon,minLat,maxLon,maxLat`.
- An unknown query parameter answers `400`. Requests are rate limited per client (`429` with
  `Retry-After`).
- A product's current data is cached at the edge for a quarter of its feed's cadence, between 15
  seconds and five minutes. History windows that ended more than an hour ago are cached for a day.
- Every product states its `cadenceSeconds`, `licence` and `attribution`. The code is MIT; the data is
  not — it belongs to the institution that published it.

## For assistants

[`/mcp`](https://open-data.pt/mcp) is a keyless MCP server: a `search` tool over the OpenAPI document
and an `execute` tool against the API. [`/llms.txt`](https://open-data.pt/llms.txt) is the plain-text
guide to what exists and how to call it.
