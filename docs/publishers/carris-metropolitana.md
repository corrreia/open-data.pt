# Carris Metropolitana

The bus operator of the Lisbon metropolitan area, and the clearest case of one publisher read two
ways: their own API and their GTFS feed are separate libraries, and one publisher on the site.

## Source

| Feed                             | Library  | Cadence    | Notes                                   |
| -------------------------------- | -------- | ---------- | --------------------------------------- |
| `carris-lines-feed`              | `carris` | daily      | Reference data                          |
| `carris-routes-feed`             | `carris` | daily      | Route variants, colours, municipalities |
| `carris-stops-feed`              | `carris` | daily      | ~13,000 stops in a 6.8 MB answer        |
| `carris-vehicles-feed`           | `carris` | 1 minute   | Live fleet state and minute summaries   |
| `carris-alerts-feed`             | `carris` | 15 minutes | Service disruptions, with corrections   |
| `carris-metropolitana-gtfs-feed` | `gtfs`   | daily      | The static schedule archive, CC BY 4.0  |

`CARRIS_API_ORIGIN` is `https://api.carrismetropolitana.pt`. No credentials; nothing to arrange.

## Quirks

**Vehicle positions are not history.** They move every minute, so their revisions are noise — about
1.1 million lake rows a day. `vehicles-current` and `fleet-summary` are both named in the policy's
`withoutHistory`, and what keeps every minute is the active-vehicles series, which the summary would
otherwise repeat.

**Their vehicle timestamps changed units.** `/v2/vehicles` moved from Unix seconds to milliseconds in
September 2026; the transformer accepts either, treating anything at or above 100,000,000,000 as
milliseconds. A value read in the wrong unit lands in 1970 or in the far future, and dates every row
wrongly.

**Stops nearly hits the output cap.** 6.8 MB in, and the feed raises `maxOutputBytes` to 64 MB to keep
the normalized form comfortably inside it.

**Alerts are posted days ahead.** Five-minute polling never saw one change, so the feed settles at 15
minutes.

**The GTFS archive has no `calendar.txt`.** Carris publishes service days only as `calendar_dates.txt`,
so the feed names the files it wants rather than declaring a product the archive never fills. That
archive is distributed with a CC BY 4.0 licence; the API's own feeds are served under `source-terms`,
because Carris states no licence for them.
