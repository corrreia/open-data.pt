---
name: open-data-pt
description: Find and read Portuguese public data (energy and fuel prices, mobility, weather and environment, health, statistics, cities) from open-data.pt, a free, keyless, read-only JSON API over what Portuguese institutions and operators publish. Use when a question needs current or historical figures from Portugal's public sources.
---

# Portuguese public data from open-data.pt

open-data.pt collects datasets from the Portuguese institutions and operators that publish them and serves them in one format. There is no key and no account, and only GET works.

## Connect

- MCP: add `https://open-data.pt/mcp` (Streamable HTTP, no key). Its `search` tool runs JavaScript against the OpenAPI document; `execute` runs it against the API through `codemode.request()`.
- HTTP: every path under `https://open-data.pt/api/`, described by `https://open-data.pt/openapi.json`.

## Read data

1. `GET /api/products` lists every product: slug, title, description, role, schema, rowCount, cadence and freshness. Choose by title and description; filter the list in code instead of printing it whole.
2. The role says how to read a product:
   - `reference`, `current-state`, `event-log` and `summary`: `GET /api/products/{slug}/records?limit=500`, passing `nextCursor` back as `cursor`, or `/records/all` for every row at once. Filter with `where=field:value` (up to five, all must match) and `bbox=minLon,minLat,maxLon,maxLat`.
   - `time-series`: `GET /api/products/{slug}/series` with `seriesKey`, `from`, `to` and `limit` (up to 1000).
3. History: `/events`, `/series/range`, `/changes/range` and `/series/changes/range` take `from` and `to` (ISO 8601 UTC, at most 366 days apart), page with `nextCursor`, and report their `coverage`.
4. `GET /api/feeds` says where each dataset comes from and who publishes it; `GET /api/outages` says when a source was down.

## Rules

- Cite the publisher, licence and attribution named on the product, not open-data.pt.
- Check `stale`, `updatedAt` and `coverage` before calling data current or complete.
- Pass cursors back unchanged. Unknown query parameters answer 400.
- Answers are cached for 10 to 300 seconds, so do not poll faster than a product's cadence. After a 429, wait as long as `Retry-After` says.

The full guide is at https://open-data.pt/llms.txt.
