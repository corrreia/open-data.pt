# Carris Metropolitana vehicle positions

`carris-vehicles-feed`, the busiest feed on the platform, and the clearest worked example of the
difference between what a feed serves and what it keeps. One collection a minute, three products:
`carris-vehicles-current`, `carris-fleet-summary` and `carris-active-vehicles-series`.

## The configuration

```ts
{
  slug: "carris-vehicles-feed",
  config: { source: "carris", feed: "vehicles" },
  policy: {
    collection: {
      cadenceSeconds: 60,
      timeoutSeconds: 20,
      maxBytes: 10 * 1024 * 1024,
      historyMode: "changes",
      withoutHistory: ["vehicles-current", "fleet-summary"],
    },
    serving: { licence: "source-terms", attribution: "Carris Metropolitana" },
  },
  staleAfterSeconds: 180,
}
```

Every minute, because the fleet moves every minute. `staleAfterSeconds: 180` gives it two missed
collections before the site calls it stale.

## What it keeps, and what it does not

`historyMode: "changes"` would make a lake row out of every changed vehicle: roughly 1.1 million rows
a day, all of them a bus being a few metres further along a road it drives every day. So the two
products whose revisions are noise are named in `withoutHistory`:

- **`vehicles-current`** — current position and state per vehicle. Serving it is the point; keeping
  every past position is not.
- **`fleet-summary`** — the counts of the fleet right now (`carris-fleet-summary`). Every number in it
  is already a point of the active-vehicles series, which keeps every minute. Publishing both as
  history would be the same value twice.

What remains is the series: one point a minute, forever, which is what a question like "how many buses
run on a Sunday in August" actually needs.

## Reading it

```bash
curl "https://open-data.pt/api/products/carris-vehicles-current/records?limit=5"
curl "https://open-data.pt/api/products/carris-active-vehicles-series/series"
curl "https://open-data.pt/api/products/carris-vehicles-current.geojson"
```

## Known trap

Their `/v2/vehicles` timestamps moved from Unix seconds to milliseconds in September 2026. The
transformer accepts either — anything at or above 100,000,000,000 is milliseconds — because a value
read in the wrong unit dates every row in 1970 or in the year 3000, and those dates are what the lake
partitions by. See [Carris Metropolitana](../publishers/carris-metropolitana.md).
