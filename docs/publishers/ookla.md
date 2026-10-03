# Ookla

The company behind Speedtest. Every quarter it publishes the average speed and latency of the tests
people ran with Speedtest's apps, in tiles of about half a kilometre across the world, as its "Global
Fixed and Mobile Network Performance Maps" ([teamookla/ookla-open-data](https://github.com/teamookla/ookla-open-data)).
We keep the tiles that fall on Portugal.

## Source

Ookla's public bucket on Amazon S3, `ookla-open-data.s3.amazonaws.com`, read anonymously over HTTPS by
the `parquet` library in [their folder](../../apps/gatekeeper/src/publishers/ookla/). One Parquet file
per quarter and layer, from Q1 2019: `parquet/performance/type={fixed|mobile}/year=YYYY/quarter=Q/YYYY-MM-01_performance_{fixed|mobile}_tiles.parquet`,
some 150 to 360 MB each. `fixed` holds tests over Wi-Fi or a cable, `mobile` over a cellular
connection, both from phones that reported a GPS-quality location. Two feeds, one per layer:

- **`ookla-fixed-broadband-performance-feed`**, about 40,000 Portuguese tiles a quarter;
- **`ookla-mobile-network-performance-feed`**, about 21,500.

Each runs weekly: one listing of the layer's files (`?list-type=2&prefix=parquet/performance/type=<layer>/`,
about 10 KB). When the newest file is the one the last collection read, by key and ETag, that is all;
Ookla adds a quarter a few weeks after it ends, so a new one is read within a week. A new quarter, or
the newest one written again, is read as below. After the first live collection, each feed walks back
once, a quarter a slice and at least ten minutes apart (`history.minSliceSeconds`), to Q1 2019: 29
slices a feed, about five hours.

## Reading a few hundred MB for 40,000 rows

A file is far larger than a Worker's 128 MB, and decoding a whole row group took 481 MB, so nothing
is read whole. What makes it possible is that Ookla sorts every file by quadkey, and each tile's
quadkey is its place in Z-order: Portugal is a handful of quadkey ranges, a few thousand quadkey
prefixes in all (`parquet/quadkeys.ts`, made once from Natural Earth's 1:10m boundaries; its header
says how). The reader (`parquet/reader.ts`):

1. reads the file's last 64 KB in one ranged request: the footer, and with it every row group's
   quadkey statistics;
2. for each row group whose quadkeys can fall in those ranges, streams its quadkey column chunk with
   one ranged request, page by page as the bytes arrive: a page whose header statistics say it cannot
   hold one of Portugal's tiles is dropped undecompressed; once the pages are past Portugal's last
   range, the request is cancelled;
3. streams each of the seven value columns the same way (never the WKT polygons nor the centroids,
   which the quadkey gives), decoding only the pages that hold a selected row, and stopping after the
   last.

Every range is bound to the version the listing named (`If-Match` with its ETag), so a file Ookla
replaces halfway through fails the collection, to be tried again, rather than mixing two versions.
What it holds at once is a page or two (Ookla's are at most about 1 MB decompressed), the dictionary
of the column it is reading, and one row group's selected rows.

Measured from here, a quarter costs 9 to 46 MB of ranged reads (the most for fixed Q3 2021 and the
2019 files, written as a single row group, where everything before Portugal in the chunk is read and
dropped), in 7 to 25 requests besides the listing; `maxBytes` stops a collection at 96 MiB. Node's
main thread was busy 6 to 12 s per quarter, and the JS heap stayed under 60 MB with
`--max-old-space-size=64`; the library declares a minute of CPU. The two walks read about 1.1 GB from
Ookla's bucket, in about 900 requests, five hours each.

The reader takes flat columns, version 1 data pages, plain and dictionary encodings, and Snappy:
what Arrow's Parquet writer (2019, 2021 Q3, 2026 Q2) and Amazon Redshift's UNLOAD (2020 to 2026 Q1)
wrote. Anything else fails the collection with `invalid-response`, so a change of writer shows up as
a failing feed, not as wrong rows.

## Quirks

- Older files lack columns: loaded latency (`avg_lat_down_ms`, `avg_lat_up_ms`) began in Q4 2022 and
  not every Speedtest client measures it, so it is null where it is missing; `tile_x`/`tile_y` came
  with Q3 2023 and are not read.
- The bucket holds folder markers (`…/quarter=2/`, 0 bytes) beside the files; the listing skips
  anything that is not a quarter's file.
- Ookla may write a quarter again to honour a data subject's request (GDPR, CCPA, LGPD), so the same
  quarter read twice may differ. The live feed reads the newest quarter again when its ETag changes;
  older quarters are read once, by the walk.
- A tile appears only in the quarters someone tested in it. The table is the newest quarter's, so a
  tile with no test in it leaves the table, though not its history.
- Ookla's README of 16 April 2026: "supported regions have been updated", and some areas may no
  longer be in the data. Portugal still is.
- Tiles within about a kilometre of the Spanish border may fall on either side of it: Natural Earth's
  border is drawn to about that.

## Licence

The README states [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) (`cc-by-nc-sa-4.0`).
Under our licensing policy, non-commercial terms do not stop us republishing; they travel with the
data: whoever reuses it from us may do so for non-commercial purposes only, crediting Ookla, and must
share what they make from it under the same licence. The site shows the licence on both feeds and
every product.

The README suggests this attribution:

> Speedtest® by Ookla® Global Fixed and Mobile Network Performance Maps was accessed on [DAY MONTH YEAR]
> from [AWS]. Based on [LICENSEE'S] analysis of Speedtest® by Ookla® Global Fixed and Mobile Network
> Performance Maps for [DATA TIME PERIOD]. Ookla trademarks used under license and reprinted with
> permission.

A feed's attribution is one static line, so ours names when (when each quarter was collected), what we
did (kept the tiles that fall on Portugal) and for which period (the quarter each row names), and keeps
the trademark sentence. We show no Ookla logo: their trademarks need their written permission, so the
site shows their initials.
