export function openApiDocument(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "open-data.pt API",
      version: "0.1.0",
      // What a reader needs before the first request, and nothing that a tag, an endpoint or a
      // parameter says better where it is used.
      description: [
        "Free, keyless, read-only JSON over Portuguese public data. No account, no API key, no paid tier, and no plan to add one. Every product carries the licence and attribution of the institution that published it; cite the publisher, not this site.",
        "",
        "**Start with `GET /api/products`.** It lists every product with its slug, role and freshness; read `GET /api/products/{slug}` for one of them, then its rows with `/records` or its points with `/series`, whichever its role calls for.",
        "",
        "Every endpoint answers GET, HEAD and OPTIONS, and nothing here changes anything: the platform collects its sources by itself. An unknown query parameter is a `400`, errors are `application/problem+json`, and a read the cache cannot answer is rate limited per client with `Retry-After`.",
        "",
        "The API is unversioned while the platform is in development.",
      ].join("\n"),
      license: {
        name: "Dataset-specific licenses",
        identifier: "LicenseRef-Dataset",
      },
    },
    servers: [{ url: origin }],
    // A tag carries what is true of every endpoint under it: the history rules belong here rather
    // than repeated in the introduction and in each of the four windows.
    tags: [
      {
        name: "Products",
        description: [
          "Read a product's current rows or points, and its past. `/records`, `/records/all` and the GeoJSON export filter with `where` and `bbox`; `/series` serves a time-series product's recent window.",
          "",
          "History is queryable. `/events` and `/series/range` answer what was true over an event-time window, as known now or at any past `knownAt`; `/changes/range` and `/series/changes/range` list every revision the platform learned over a knowledge-time window, corrections included. A window is at most 366 days, pages follow deterministic cursors, and every answer states its freshness and its coverage, including when the lake begins. Arbitrary SQL is not exposed.",
          "",
          "A window that ended more than an hour ago is cached for a day; everything else for 10 to 300 seconds, a quarter of the feed's cadence.",
        ].join("\n"),
      },
      { name: "Feeds", description: "Where each dataset comes from and how its collection is going: feeds, runs and outages. Read-only." },
      {
        name: "Platform",
        description:
          "Discovery and health. The same API answers Model Context Protocol at `/mcp`, a plain-text summary is at `/llms.txt`, and the guide for people is at `/start/`.",
      },
    ],
    paths: {
      "/api": {
        get: {
          operationId: "getApiIndex",
          tags: ["Platform"],
          summary: "Where to start: links to the product list, the catalog, the guide and the history endpoints",
          parameters: [],
          responses: { "200": jsonResponse("API index", { type: "object" }), ...reads() },
        },
      },
      "/api/health": {
        get: {
          operationId: "getHealth",
          tags: ["Platform"],
          summary: "Liveness check",
          parameters: [],
          responses: { "200": jsonResponse("The API is up", { type: "object", required: ["status"], properties: { status: { type: "string", const: "ok" } } }), ...reads() },
        },
      },
      "/api/analytics": {
        get: {
          operationId: "getAnalytics",
          tags: ["Platform"],
          summary: "How open-data.pt is used: requests to the site, the API and the MCP server, by client, route, dataset and country",
          description:
            "Counts from Cloudflare Workers Analytics Engine, one data point per request, kept for 90 days. No IP address, cookie or visitor identifier is recorded. `surface` is `web` (pages), `api` (API requests from outside this site), `mcp` (MCP messages), `mcp-read` (API reads made by MCP code runs), `docs` (the API reference and OpenAPI document) or `discovery` (sitemap and .well-known documents). Clients are classified by User-Agent into `browser`, `library`, `ai-agent`, `crawler` and `unknown`. The API reads this site's own pages make are not counted, since the page view already is. Cached for 30 minutes.",
          parameters: [
            {
              name: "days",
              in: "query",
              required: false,
              description: "Window: the last 24 hours (by hour), or the last 7, 30 or 90 UTC days (by day).",
              schema: { type: "integer", enum: [1, 7, 30, 90], default: 7 },
            },
          ],
          responses: {
            "200": jsonResponse("Request counts over the window", {
              type: "object",
              required: ["days", "resolution", "from", "to", "retentionDays", "timeline", "clients", "routes", "subjects", "countries", "referrers", "outcomes", "mcp"],
              properties: {
                days: { type: "integer" },
                resolution: { type: "string", enum: ["hour", "day"] },
                from: { type: "string", format: "date-time" },
                to: { type: "string", format: "date-time" },
                retentionDays: { type: "integer" },
                timeline: countsOf({ time: { type: "string", format: "date-time" }, surface: { type: "string" }, kind: { type: "string" } }),
                clients: countsOf({ surface: { type: "string" }, kind: { type: "string" }, name: { type: "string" } }),
                routes: countsOf({ surface: { type: "string" }, route: { type: "string" }, meanMs: { type: "number", description: "Mean time to answer, in milliseconds." } }),
                subjects: countsOf({
                  surface: { type: "string" },
                  route: { type: "string" },
                  subject: { type: "string", description: "The product, feed, publisher, licence or topic asked for." },
                }),
                countries: countsOf({ surface: { type: "string" }, country: { type: "string", description: "ISO 3166-1 alpha-2, as Cloudflare locates the client." } }),
                referrers: countsOf({ surface: { type: "string" }, referrer: { type: "string", description: "The linking site's host, or the AI assistant's name." } }),
                outcomes: countsOf({
                  surface: { type: "string" },
                  status: { type: "string" },
                  cache: { type: "string", enum: ["hit", "miss", "none"] },
                  format: { type: "string" },
                }),
                mcp: countsOf({
                  call: { type: "string", description: "JSON-RPC method, with the tool for tools/call." },
                  client: { type: "string", description: "The MCP client's own name, on initialize." },
                }),
              },
            }),
            ...reads(),
            "502": responseRef("AnalyticsUnavailable"),
            "503": responseRef("AnalyticsUnavailable"),
          },
        },
      },
      "/api/feeds": {
        get: {
          operationId: "listFeeds",
          tags: ["Feeds"],
          summary: "List public feeds with their schedule and freshness",
          parameters: [],
          responses: { "200": jsonResponse("Feeds", dataOf("Feed")), ...reads() },
        },
      },
      "/api/feeds/{feedId}": {
        get: {
          operationId: "getFeed",
          tags: ["Feeds"],
          summary: "Get one feed with its latest runtime status",
          parameters: [pathParameter("feedId", "Feed ID")],
          responses: { "200": jsonResponse("Feed", { type: "object", required: ["data"], properties: { data: schemaRef("Feed") } }), "404": responseRef("NotFound"), ...reads() },
        },
      },
      "/api/acquisitions": {
        get: {
          operationId: "listAcquisitions",
          tags: ["Feeds"],
          summary: "List collection runs across public feeds or of one feed, newest first; with `day`, every run of that UTC day",
          description:
            "Read from the Registry's bounded mirror of the 5,000 most recent runs, each filed under the time it completed. `limit` is at most 200, or 1000 with `day`. With `day` the response also says whether it holds every run of that day (`complete`): false when the mirror no longer reaches back to the start of the day, or when the day has more runs than `limit`.",
          parameters: [queryParameter("feedId", "Optional feed ID."), queryParameter("day", "Optional calendar day, YYYY-MM-DD (UTC)."), integerParameter("limit", 50, 1, 1000)],
          responses: {
            "200": jsonResponse("Runs, newest first", {
              type: "object",
              required: ["data"],
              properties: {
                day: { type: "string", format: "date", description: "With `day` only." },
                complete: {
                  type: "boolean",
                  description:
                    "With `day` only: whether `data` holds every run of that day; false when the mirror no longer reaches back to its start or `limit` cut the list short.",
                },
                data: { type: "array", items: schemaRef("Acquisition") },
              },
            }),
            ...reads(),
          },
        },
      },
      "/api/outages": {
        get: {
          operationId: "listOutages",
          tags: ["Feeds"],
          summary: "When each feed's live collection kept failing, and when the platform collected nothing, over the last days",
          description:
            "An outage runs from a feed's first failed live collection to its next success. `cause` says whether the source did not answer (`source`), collection failed on this platform's side (`collection`), or the platform stopped collecting altogether (`platform`, with a null `feedId`). Nothing is recorded before `trackedSince`.",
          parameters: [integerParameter("days", 90, 1, 90)],
          responses: {
            "200": jsonResponse("Outages overlapping the window, newest first", {
              type: "object",
              required: ["from", "to", "trackedSince", "data"],
              properties: {
                from: { type: "string", format: "date-time" },
                to: { type: "string", format: "date-time" },
                trackedSince: { type: ["string", "null"], format: "date-time" },
                data: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["feedId", "startedAt", "cause", "failures"],
                    properties: {
                      feedId: { type: ["string", "null"] },
                      startedAt: { type: "string", format: "date-time" },
                      endedAt: { type: "string", format: "date-time", description: "Absent while the outage is still going on." },
                      cause: { type: "string", enum: ["source", "collection", "platform"] },
                      failures: { type: "integer", minimum: 0 },
                      lastError: { type: "string" },
                    },
                  },
                },
              },
            }),
            ...reads(),
          },
        },
      },
      "/api/catalog.dcat.json": {
        get: {
          operationId: "getDcatCatalog",
          tags: ["Products"],
          summary: "Get a DCAT 3 JSON-LD projection of published products",
          parameters: [],
          responses: {
            "200": { description: "DCAT JSON-LD catalog", content: { "application/ld+json": { schema: { type: "object" } } } },
            ...reads(),
          },
        },
      },
      "/api/products": {
        get: {
          operationId: "listProducts",
          tags: ["Products"],
          summary: "List cleaned products, current views, series, and summaries",
          parameters: [],
          responses: { "200": jsonResponse("Products", dataOf("Product")), ...reads() },
        },
      },
      "/api/products/{slug}": {
        get: {
          operationId: "getProduct",
          tags: ["Products"],
          summary: "Get one published product",
          parameters: [pathParameter("slug", "Stable product slug")],
          responses: { "200": jsonResponse("Product", schemaRef("Product")), "404": responseRef("NotFound"), ...reads() },
        },
      },
      "/api/products/{slug}.geojson": {
        get: {
          operationId: "getProductGeoJson",
          tags: ["Products"],
          summary: "Get a product's geometry or coordinate records as a streamed GeoJSON FeatureCollection",
          description: "Filtered exports omit `numberMatched`; `numberReturned` is always at the end. Counts against the stricter rate limit.",
          parameters: [pathParameter("slug", "Stable product slug"), whereParameter(), bboxParameter()],
          responses: {
            "200": { description: "GeoJSON FeatureCollection", content: { "application/geo+json": { schema: { type: "object" } } } },
            "404": responseRef("NotFound"),
            ...reads(),
          },
        },
      },
      "/api/products/{slug}/records/all": {
        get: {
          operationId: "listAllProductRecords",
          tags: ["Products"],
          summary: "Get every current record of a product in one streamed response",
          description:
            "The same rows as `/records`, without a cursor, as `{numberMatched, data, numberReturned}`. Filtered exports omit `numberMatched`; `numberReturned` is always at the end. A `time-series` product serves no records here: read its points with `/series`. Counts against the stricter rate limit.",
          parameters: [pathParameter("slug", "Stable product slug"), whereParameter(), bboxParameter()],
          responses: {
            "200": jsonResponse("Every current record", {
              type: "object",
              required: ["data", "numberReturned"],
              properties: { numberMatched: { type: "integer" }, data: { type: "array", items: schemaRef("Record") }, numberReturned: { type: "integer" } },
            }),
            "404": responseRef("NotFound"),
            ...reads(),
          },
        },
      },
      "/api/products/{slug}/records": {
        get: {
          operationId: "listProductRecords",
          tags: ["Products"],
          summary: "Read the current reference, state, summary, or event records",
          description:
            "A page reads a bounded number of chunks. With a selective filter a page can hold fewer rows than `limit`, or none, and still carry `nextCursor`; follow it until it is absent.",
          parameters: [
            pathParameter("slug", "Stable product slug"),
            integerParameter("limit", 50, 1, 500),
            queryParameter("cursor", "Opaque continuation key from the previous response."),
            timeParameter("validAt", "Only records valid at this RFC 3339 time."),
            whereParameter(),
            bboxParameter(),
          ],
          responses: {
            "200": jsonResponse("Current records", {
              type: "object",
              required: ["data"],
              properties: {
                data: { type: "array", items: schemaRef("Record") },
                nextCursor: { type: "string", description: "Absent on the last page; pass it back as `cursor`." },
              },
            }),
            "404": responseRef("NotFound"),
            ...reads(),
          },
        },
      },
      "/api/products/{slug}/changes": {
        get: {
          operationId: "listProductChanges",
          tags: ["Products"],
          summary: "Read the latest corrections, retractions, deletions, and updates in knowledge-time order",
          parameters: [
            pathParameter("slug", "Stable product slug"),
            timeParameter("knownAt", "Only changes known at or before this RFC 3339 time."),
            integerParameter("limit", 100, 1, 500),
          ],
          responses: { "200": jsonResponse("Product changes", dataOf("Change")), "404": responseRef("NotFound"), ...reads() },
        },
      },
      "/api/products/{slug}/series": {
        get: {
          operationId: "listProductSeries",
          tags: ["Products"],
          summary: "Read the recent window of time-series points",
          parameters: [
            pathParameter("slug", "Stable product slug"),
            queryParameter("seriesKey", "Optional series key."),
            timeParameter("from", "Inclusive event-time lower bound."),
            timeParameter("to", "Inclusive event-time upper bound."),
            integerParameter("limit", 100, 1, 1000),
          ],
          responses: { "200": jsonResponse("Time-series points", dataOf("SeriesPoint")), ...reads() },
        },
      },
      "/api/products/{slug}/series/changes": {
        get: {
          operationId: "listProductSeriesChanges",
          tags: ["Products"],
          summary: "Read recent time-series corrections in knowledge-time order",
          parameters: [
            pathParameter("slug", "Stable product slug"),
            queryParameter("seriesKey", "Optional series key."),
            timeParameter("from", "Inclusive event-time lower bound."),
            timeParameter("to", "Inclusive event-time upper bound."),
            integerParameter("limit", 100, 1, 1000),
          ],
          responses: { "200": jsonResponse("Time-series corrections", dataOf("SeriesChange")), "404": responseRef("NotFound"), ...reads() },
        },
      },
      "/api/products/{slug}/events": {
        get: {
          operationId: "listProductEvents",
          tags: ["Products"],
          summary: "Read the applicable revision of each event in an event-time window, as known now or at `knownAt`",
          parameters: [
            ...historyWindow("event-time"),
            timeParameter("knownAt", "Read the window as it was known at this RFC 3339 time."),
            queryParameter("cursor", "Opaque compound continuation cursor."),
            integerParameter("limit", 200, 1, 500),
          ],
          responses: { "200": jsonResponse("Deduplicated event revisions with freshness and coverage", schemaRef("HistoryPage")), ...historyErrors() },
        },
      },
      "/api/products/{slug}/changes/range": {
        get: {
          operationId: "listProductChangeRange",
          tags: ["Products"],
          summary: "Read every revision ingested in a knowledge-time window, newest first",
          description: "Record products return record revisions. Time-series products return point revisions, as `/series/changes/range` does, and accept `seriesKey`.",
          parameters: [
            ...historyWindow("knowledge-time"),
            queryParameter("seriesKey", "Time-series products only: one series key."),
            queryParameter("cursor", "Opaque compound continuation cursor."),
            integerParameter("limit", 200, 1, 1000),
          ],
          responses: { "200": jsonResponse("Revisions with freshness and coverage", schemaRef("HistoryPage")), ...historyErrors() },
        },
      },
      "/api/products/{slug}/series/range": {
        get: {
          operationId: "listProductSeriesRange",
          tags: ["Products"],
          summary: "Read the value of each point in an event-time window, as known now or at `knownAt`",
          description:
            "Without `knownAt`, each point's latest revision. With it, the latest revision observed at or before that time, so a window reads exactly as it was published then.",
          parameters: [
            ...historyWindow("event-time"),
            timeParameter("knownAt", "Read the window as it was known at this RFC 3339 time."),
            queryParameter("seriesKey", "Optional series key."),
            queryParameter("cursor", "Opaque compound continuation cursor."),
            integerParameter("limit", 500, 1, 1000),
          ],
          responses: {
            "200": jsonResponse("Deduplicated series points with freshness and coverage", { allOf: [schemaRef("HistoryPage"), dataOf("SeriesPoint")] }),
            ...historyErrors(),
          },
        },
      },
      "/api/products/{slug}/series/changes/range": {
        get: {
          operationId: "listProductSeriesChangeRange",
          tags: ["Products"],
          summary: "Read every point revision ingested in a knowledge-time window: new points and corrections, newest first",
          parameters: [
            ...historyWindow("knowledge-time"),
            queryParameter("seriesKey", "Optional series key."),
            queryParameter("cursor", "Opaque compound continuation cursor."),
            integerParameter("limit", 500, 1, 1000),
          ],
          responses: { "200": jsonResponse("Point revisions with freshness and coverage", schemaRef("HistoryPage")), ...historyErrors() },
        },
      },
      "/api/products/{slug}/series/summary": {
        get: {
          operationId: "getProductSeriesSummary",
          tags: ["Products"],
          summary: "Read any window of a time series by hour, Lisbon day or Lisbon month",
          description:
            "The count, mean, lowest and highest of each point's latest value per bucket, read from summary files rather than the lake, so long windows cost little. Summaries cover the Lisbon days from `coverage.firstDay`, back into backfilled history, to `coverage.through`; each day is summarised a day after it ends, and history published late is added the day after it arrives. Points after `coverage.until` are read from `/series`. Every bucket covers its whole period: a period belongs to the window when the period itself starts in it, so no bucket is a slice of the day or month it is named for, and the last one may reach past `to`. Without `resolution`, windows up to 14 days come back by the hour, up to about three years by the day, and longer ones by the month, counted from where the product's history begins: decades of a short history come back by the day or the hour. Backfilled history before the service began is kept by Lisbon day, so it comes back by the day when asked for hours.",
          parameters: [
            pathParameter("slug", "Stable product slug"),
            requiredQueryParameter("from", "Inclusive RFC 3339 lower bound.", { type: "string", format: "date-time" }),
            requiredQueryParameter("to", "Exclusive RFC 3339 upper bound. The summarised span between the two may cover at most 36 months by hour or day, or 50 years by month.", {
              type: "string",
              format: "date-time",
            }),
            {
              name: "resolution",
              in: "query",
              required: false,
              description: "`hour`, `day` or `month`. A month kept by day answers `day` when asked for hours.",
              schema: { type: "string", enum: ["hour", "day", "month"] },
            },
            {
              name: "seriesKey",
              in: "query",
              required: false,
              description: "Up to ten series; repeat the parameter for each. Without it, every series, up to 20,000 buckets in all.",
              style: "form",
              explode: true,
              schema: { type: "array", maxItems: 10, items: { type: "string" } },
            },
          ],
          responses: { "200": jsonResponse("Buckets per series", schemaRef("SeriesSummary")), ...reads(), "404": responseRef("NotFound") },
        },
      },
      "/api/products/{slug}/series/summary/{period}": {
        get: {
          operationId: "getProductSeriesSummaryFile",
          tags: ["Products"],
          summary: "Download one Lisbon month or year of a time series' summaries, as stored",
          description:
            "The files the window endpoint reads. A month (`YYYY-MM`) holds hourly buckets, or daily ones for backfilled history and for a month too large for hours (`resolution`). A year (`YYYY`) holds one bucket per series and Lisbon month. Once a period is over and its last day summarised, its file changes only when late data arrives, at most once a day, and it is cached for a day.",
          parameters: [
            pathParameter("slug", "Stable product slug"),
            {
              name: "period",
              in: "path",
              required: true,
              description: "A Lisbon calendar month, YYYY-MM, or year, YYYY.",
              schema: { type: "string", pattern: "^\\d{4}(-\\d{2})?$" },
            },
          ],
          responses: {
            "200": jsonResponse("One month or year of summary buckets", { oneOf: [schemaRef("SeriesSummaryMonth"), schemaRef("SeriesSummaryYear")] }),
            ...reads(),
            "404": responseRef("NotFound"),
          },
        },
      },
    },
    components: {
      schemas: {
        Product: {
          type: "object",
          required: ["id", "slug", "feedId", "title", "description", "role", "schema", "rowCount", "stale", "licence", "attribution", "updatedAt"],
          properties: {
            id: { type: "string" },
            slug: { type: "string", description: "Stable; every product URL uses it." },
            feedId: { type: "string", description: "The feed that collects it: `/api/feeds/{feedId}`." },
            title: { type: "string" },
            description: { type: "string" },
            role: {
              type: "string",
              enum: ["reference", "current-state", "event-log", "time-series", "summary"],
              description: "`time-series` is read with `/series`; every other role with `/records`.",
            },
            schema: { type: "object", required: ["fields"], properties: { fields: { type: "array", items: schemaRef("Field") } } },
            version: { type: "integer" },
            status: { type: "string", enum: ["current", "failed"] },
            currentAcquisitionId: { type: ["string", "null"], description: "The run that built the current version." },
            watermark: { type: ["string", "null"] },
            rowCount: { type: "integer", description: "Records for every role but `time-series`, whose count is its points." },
            completeness: { type: "string", enum: ["complete", "partial", "unknown"] },
            stale: { type: "boolean" },
            staleAfterSeconds: { type: ["integer", "null"] },
            cadenceSeconds: { type: ["integer", "null"], description: "How often its feed is collected." },
            historyMode: { type: "string", enum: ["changes", "latest"] },
            exposeHistory: { type: "boolean", description: "Whether the history endpoints serve it." },
            licence: { ...schemaRef("Term"), description: "The terms the product is served under." },
            attribution: { type: "string", description: "Credit the publisher with this, not open-data.pt." },
            hasChanges: { type: "boolean", description: "Whether `/changes` has recent changes." },
            hasSeries: { type: "boolean", description: "Whether `/series` has points." },
            updatedAt: time(),
          },
        },
        Term: {
          type: "object",
          required: ["id", "name"],
          description: "One entry of a catalog vocabulary (a publisher, a licence): a stable key to filter by, a name to show, and its page when it has one.",
          properties: {
            id: { type: "string", description: "Stable; `/publisher/?id=` and `/licence/?id=` use it." },
            name: { type: "string" },
            url: { type: "string", format: "uri" },
            description: { type: "string", description: "What a licence permits or which publisher terms govern it." },
            logo: {
              type: "string",
              format: "uri",
              description: "A publisher's mark, served from this site, to show beside their name. It is their trademark, not part of the data, and no dataset licence covers it.",
            },
          },
        },
        Field: {
          type: "object",
          required: ["id", "name", "type", "nullable"],
          properties: {
            id: { type: "string" },
            name: { type: "string", description: "The key this field has in each record." },
            type: {
              type: "string",
              enum: ["boolean", "category", "color", "date", "datetime", "geometry", "identifier", "json", "latitude", "longitude", "number", "string", "url"],
            },
            nullable: { type: "boolean" },
            unit: { type: "string" },
            display: { type: "object", properties: { label: { type: "string" }, badge: { type: "object" } } },
          },
        },
        Record: {
          type: "object",
          description: "The product's own fields, as its schema lists them, plus `id` and `_time`.",
          required: ["id", "_time"],
          properties: {
            id: { type: "string", description: "The entity key; stable across versions." },
            _time: {
              type: "object",
              properties: {
                event: nullableTime(),
                validFrom: nullableTime(),
                validTo: nullableTime(),
                sourcePublished: nullableTime(),
                sequence: { type: ["string", "null"] },
                observed: time("When this exact value was first observed."),
              },
            },
          },
          additionalProperties: true,
        },
        Change: {
          type: "object",
          required: ["id", "entityKey", "operation", "observedAt"],
          properties: {
            id: { type: "string" },
            entityKey: { type: "string", description: "The `id` of the record it changed." },
            operation: { type: "string", enum: ["baseline", "create", "upsert", "correct", "delete", "retract"] },
            payload: { type: ["object", "null"], description: "The record's fields after the change; null for a retraction." },
            recordHash: { type: "string" },
            eventTime: nullableTime(),
            validFrom: nullableTime(),
            validTo: nullableTime(),
            sourcePublishedAt: nullableTime(),
            sourceSequence: { type: ["string", "null"] },
            observedAt: time(),
            ingestedAt: time(),
            acquisitionId: { type: "string" },
          },
        },
        SeriesSummary: {
          type: "object",
          required: ["resolution", "timeZone", "from", "to", "coverage", "series"],
          properties: {
            resolution: { type: "string", enum: ["hour", "day", "month"] },
            timeZone: { type: "string", const: "Europe/Lisbon", description: "Days and months are Lisbon calendar days and months; every bucket start is a UTC instant." },
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            coverage: {
              type: "object",
              required: ["firstDay", "through", "until"],
              properties: {
                firstDay: { type: ["string", "null"], format: "date", description: "The oldest Lisbon day any summary holds, back into backfilled history." },
                through: { type: ["string", "null"], format: "date", description: "The last Lisbon day summarised." },
                until: { type: ["string", "null"], format: "date-time", description: "The instant that day ends. Points after it are only in `/series`." },
              },
            },
            series: {
              type: "array",
              items: {
                type: "object",
                required: ["seriesKey", "unit", "dimensions", "buckets"],
                properties: {
                  seriesKey: { type: "string" },
                  unit: { type: "string" },
                  dimensions: { type: "object" },
                  buckets: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["start", "count", "mean", "min", "max"],
                      properties: {
                        start: { type: "string", format: "date-time" },
                        count: { type: "integer" },
                        mean: { type: "number" },
                        min: { type: "number" },
                        max: { type: "number" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        SeriesSummaryMonth: {
          type: "object",
          required: ["version", "product", "month", "timeZone", "resolution", "days", "series", "buckets", "updatedAt"],
          properties: {
            version: { type: "integer", const: 1, description: "The file format. A change that breaks readers gets a new version." },
            product: { type: "string" },
            month: { type: "string", pattern: "^\\d{4}-\\d{2}$" },
            timeZone: { type: "string", const: "Europe/Lisbon" },
            resolution: { type: "string", enum: ["hour", "day"] },
            days: { type: "array", items: { type: "string", format: "date" }, description: "The Lisbon days summarised so far, oldest first." },
            series: {
              type: "array",
              items: { type: "object", required: ["key", "unit", "dimensions"], properties: { key: { type: "string" }, unit: { type: "string" }, dimensions: { type: "object" } } },
            },
            buckets: {
              type: "array",
              description: "`[seriesKey, start, count, mean, min, max]`, by start and then series key. `start` is a UTC instant.",
              items: {
                type: "array",
                minItems: 6,
                maxItems: 6,
                prefixItems: [{ type: "string" }, { type: "string", format: "date-time" }, { type: "integer" }, { type: "number" }, { type: "number" }, { type: "number" }],
              },
            },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        SeriesSummaryYear: {
          type: "object",
          required: ["version", "product", "year", "timeZone", "resolution", "series", "buckets", "updatedAt"],
          properties: {
            version: { type: "integer", const: 1, description: "The file format. A change that breaks readers gets a new version." },
            product: { type: "string" },
            year: { type: "string", pattern: "^\\d{4}$" },
            timeZone: { type: "string", const: "Europe/Lisbon" },
            resolution: { type: "string", const: "month", description: "One bucket per series and Lisbon month, rolled up from that year's month files." },
            series: {
              type: "array",
              items: { type: "object", required: ["key", "unit", "dimensions"], properties: { key: { type: "string" }, unit: { type: "string" }, dimensions: { type: "object" } } },
            },
            buckets: {
              type: "array",
              description: "`[seriesKey, start, count, mean, min, max]`, by start and then series key. `start` is the UTC instant the Lisbon month begins.",
              items: {
                type: "array",
                minItems: 6,
                maxItems: 6,
                prefixItems: [{ type: "string" }, { type: "string", format: "date-time" }, { type: "integer" }, { type: "number" }, { type: "number" }, { type: "number" }],
              },
            },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        SeriesPoint: {
          type: "object",
          required: ["seriesKey", "eventTime", "value"],
          properties: {
            seriesKey: { type: "string" },
            eventTime: time(),
            value: { type: ["number", "null"] },
            unit: { type: ["string", "null"] },
            dimensions: { type: "object", description: "What the series is broken down by, such as a region." },
            observedAt: time(),
          },
        },
        SeriesChange: {
          type: "object",
          required: ["id", "seriesKey", "eventTime", "value"],
          properties: {
            id: { type: "string" },
            seriesKey: { type: "string" },
            eventTime: time(),
            value: { type: ["number", "null"] },
            previousValue: { type: ["number", "null"], description: "The value before this correction." },
            unit: { type: ["string", "null"] },
            dimensions: { type: "object" },
            observedAt: time(),
            ingestedAt: time(),
            acquisitionId: { type: "string" },
          },
        },
        Feed: {
          type: "object",
          required: ["id", "slug", "title", "description", "publisher", "topics", "format", "cadenceSeconds", "enabled"],
          properties: {
            id: { type: "string" },
            slug: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            publisher: { ...schemaRef("Term"), description: "The institution or company that made the data: never the portal it was read from." },
            topics: { type: "array", items: { type: "string" } },
            format: {
              type: "string",
              enum: ["arcgis", "ckan", "gbfs", "gtfs", "opendatasoft", "udata", "own-api"],
              description: "The standard the source publishes in, or `own-api`.",
            },
            cadenceSeconds: { type: ["integer", "null"], description: "How often it is collected." },
            staleAfterSeconds: { type: "integer" },
            enabled: { type: "boolean" },
            running: { type: "boolean" },
            consecutiveFailures: { type: "integer" },
            nextRunAt: time(),
            lastAttemptAt: time(),
            lastSuccessAt: time(),
            lastAcquisitionStatus: { type: "string", enum: ["queued", "running", "succeeded", "unchanged", "failed"] },
            sourceUrl: { type: "string", format: "uri", description: "Where the latest collection read its data; a page a person can open." },
            createdAt: time(),
            updatedAt: time(),
          },
        },
        Acquisition: {
          type: "object",
          required: ["id", "feedId", "trigger", "status", "requestedAt"],
          properties: {
            id: { type: "string" },
            feedId: { type: "string" },
            trigger: { type: "string" },
            status: { type: "string", enum: ["queued", "running", "succeeded", "unchanged", "failed"] },
            requestedAt: time(),
            startedAt: time(),
            completedAt: time(),
            observedAt: time(),
            eventTime: time(),
            sourcePublishedAt: time(),
            completeness: { type: "string", enum: ["complete", "partial", "unknown"] },
            normalizer: { type: "object", properties: { id: { type: "string" }, version: { type: "string" } } },
            quality: { type: "object", properties: { acceptedRecords: { type: "integer" }, rejectedRecords: { type: "integer" } } },
            rows: { type: "integer", description: "Rows received from the source." },
            revisions: { type: "integer", description: "Meaningful changes the run produced." },
            error: { type: "string" },
          },
        },
        HistoryPage: {
          type: "object",
          required: ["data", "nextCursor", "freshness", "coverage", "source"],
          properties: {
            data: { type: "array", items: { type: "object" } },
            nextCursor: { type: ["string", "null"], description: "Pass as `cursor` with the same window for the next page." },
            knownAt: { type: ["string", "null"], format: "date-time" },
            freshness: { type: "object", properties: { updatedAt: { type: "string", format: "date-time" }, stale: { type: "boolean" } } },
            coverage: schemaRef("Coverage"),
            source: { type: "string", const: "lake" },
          },
        },
        Coverage: {
          type: "object",
          required: ["requested", "lakeStartsAt", "coveredFrom", "complete", "reason"],
          properties: {
            requested: { type: "object", properties: { from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" } } },
            lakeStartsAt: { type: ["string", "null"], format: "date-time", description: "The first ingest day the lake holds; nothing earlier exists." },
            coveredFrom: { type: ["string", "null"], format: "date-time", description: "How far back the source's history has been walked." },
            complete: { type: "boolean" },
            reason: { type: ["string", "null"] },
          },
        },
        Problem: {
          type: "object",
          required: ["type", "title", "status", "detail"],
          properties: {
            type: { type: "string", format: "uri-reference" },
            title: { type: "string" },
            status: { type: "integer" },
            detail: { type: "string", description: "Server errors quote a request ID here and in `X-Request-Id`." },
          },
        },
      },
      responses: {
        BadRequest: problemResponse("An invalid or unknown query parameter"),
        NotFound: problemResponse("No such product or feed, or it is not public"),
        TooManyRequests: problemResponse("Too many uncached requests from this client, or every history query slot is busy", {
          "Retry-After": { description: "Seconds to wait", schema: { type: "integer" } },
        }),
        ServerError: problemResponse("Something failed on our side", { "X-Request-Id": { description: "Quote it when reporting the failure", schema: { type: "string" } } }),
        HistoryFailed: problemResponse(
          "The history query failed: the history store refused or could not run it (502), it took longer than 30 seconds (504), or open-data.pt built a query it cannot run (500). The detail says which",
          { "X-Request-Id": { description: "Quote it when reporting the failure", schema: { type: "string" } } },
        ),
        HistoryUnavailable: problemResponse("History queries are not enabled on this deployment"),
        AnalyticsUnavailable: problemResponse("Usage analytics are not enabled on this deployment (503), or Analytics Engine did not answer (502)"),
      },
    },
  } as const;
}

export function scalarReferenceHtml(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta property="csp-nonce" content="${nonce}" />
  <title>open-data.pt API reference</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.67.0"></script>
  <script nonce="${nonce}">
    Scalar.createApiReference('#app', {
      url: '/openapi.json',
      theme: 'alternate',
      layout: 'modern',
      hideModels: false,
      hideDownloadButton: false,
      showDeveloperTools: 'never',
      agent: { disabled: true },
      mcp: { name: 'open-data.pt API', url: '', disabled: true },
      metaData: { title: 'open-data.pt API reference' }
    })
  </script>
</body>
</html>`;
}

/** An OpenAPI schema or header object; plain JSON. */
type SchemaObject = Record<string, JsonLike>;
type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike };

function schemaRef(name: string) {
  return { $ref: `#/components/schemas/${name}` };
}

function responseRef(name: string) {
  return { $ref: `#/components/responses/${name}` };
}

/** Answers every read can give besides its own. */
function reads() {
  return { "400": responseRef("BadRequest"), "429": responseRef("TooManyRequests"), "500": responseRef("ServerError") };
}

/** Answers every history window can give besides its own. */
function historyErrors() {
  return { ...reads(), "404": responseRef("NotFound"), "502": responseRef("HistoryFailed"), "503": responseRef("HistoryUnavailable"), "504": responseRef("HistoryFailed") };
}

/** The slug and the two required ends of a history window. */
function historyWindow(axis: "event-time" | "knowledge-time") {
  return [
    pathParameter("slug", "Stable product slug"),
    requiredQueryParameter("from", `Inclusive RFC 3339 ${axis} lower bound.`, { type: "string", format: "date-time" }),
    requiredQueryParameter("to", `Exclusive RFC 3339 ${axis} upper bound, at most 366 days after from.`, { type: "string", format: "date-time" }),
  ];
}

function pathParameter(name: string, description: string) {
  return { name, in: "path", required: true, description, schema: { type: "string" } };
}

function queryParameter(name: string, description: string) {
  return { name, in: "query", required: false, description, schema: { type: "string" } };
}

function timeParameter(name: string, description: string) {
  return { name, in: "query", required: false, description, schema: { type: "string", format: "date-time" } };
}

function requiredQueryParameter(name: string, description: string, schema: SchemaObject) {
  return { name, in: "query", required: true, description, schema };
}

function whereParameter() {
  return {
    name: "where",
    in: "query",
    required: false,
    description: "`field:value` equality on a string, category or identifier field of the product's schema. Repeat for up to five filters; all must match.",
    style: "form",
    explode: true,
    schema: { type: "array", maxItems: 5, items: { type: "string", pattern: "^[^:]+:.*$" } },
  };
}

function bboxParameter() {
  return {
    name: "bbox",
    in: "query",
    required: false,
    description: "`minLon,minLat,maxLon,maxLat` in degrees, for products with latitude and longitude fields.",
    schema: { type: "string", examples: ["-9.25,38.69,-9.09,38.80"] },
  };
}

function integerParameter(name: string, defaultValue: number, minimum: number, maximum: number) {
  return { name, in: "query", required: false, schema: { type: "integer", default: defaultValue, minimum, maximum } };
}

/** A list of request counts, each under the named dimensions. */
function countsOf(dimensions: { [name: string]: SchemaObject }) {
  return { type: "array", items: { type: "object", required: [...Object.keys(dimensions), "requests"], properties: { ...dimensions, requests: { type: "number" } } } };
}

/** `{ data: [...] }` of one component schema. */
function dataOf(name: string) {
  return { type: "object", required: ["data"], properties: { data: { type: "array", items: schemaRef(name) } } };
}

function time(description?: string) {
  return description ? { type: "string", format: "date-time", description } : { type: "string", format: "date-time" };
}

function nullableTime() {
  return { type: ["string", "null"], format: "date-time" };
}

function jsonResponse(description: string, schema: SchemaObject) {
  return { description, content: { "application/json": { schema } } };
}

function problemResponse(description: string, headers: SchemaObject = {}) {
  return {
    description,
    headers,
    content: { "application/problem+json": { schema: schemaRef("Problem") } },
  };
}
