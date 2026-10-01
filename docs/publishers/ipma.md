# IPMA

Instituto Português do Mar e da Atmosfera, Portugal's weather, sea and seismic institute. We read ten
feeds from their open-data API and one, Meteosat fire detections, from their dataservices site.

## Source

The `ipma` library (`apps/gatekeeper/src/publishers/ipma/ipma/`) reads both hosts.

- `api.ipma.pt`: JSON and CSV files, one or a few per feed, re-read whole on every collection.
- `mf2.ipma.pt`: the "MF2 – Perigosidade Meteorológica de Fogos Rurais" site, which publishes the
  EUMETSAT LSA SAF products IPMA makes as files under `/downloads/data/`. We read one of them,
  FRP-PIXEL (`lsasaf/frp/YYYY/MM/DD/`): the fire pixels of every 15-minute Meteosat scan of the whole
  disk, as a point shapefile in Web Mercator with each pixel's fire radiative power. Only the `.shp`
  and `.dbf` of each scan are fetched (`fires.ts`, `shapefile.ts`), and only the pixels that fall on
  Portugal are kept.

Everything else on mf2 is out of reach on purpose: the AROME, ECMWF and fire-index layers are NetCDF-4
(HDF5) grids or WMS images, which a Worker cannot read sensibly and which are not records or series;
the station FWI and RCM files stopped on 19 June 2026; and the map's own `/services/fires/<time>` and
`/services/fwi-points/<time>` JSON answer empty or 502 for anything but the current day.

## Access

No credential. IPMA is known to block readers who ask too much, so mf2 is paced at two seconds
between requests (`minIntervalSeconds` in their `index.ts`), and the fire feed asks for as little as
it can:

- every 15 minutes, the scans published since its cursor (`nextScan` in its checkpoint): two files of
  a few kilobytes each, usually one scan;
- nothing at all when no new scan is due, and a single request when the next one is not written yet;
- at most four scans a collection, so it catches up after an outage at four times the pace; a cursor
  more than a day behind restarts at the last hour.

There is no history walk. The archive goes back to 2017, but at two requests per 15-minute scan it is
over 600,000 requests, which IPMA would rightly refuse; a bounded walk over chosen fire seasons would
need asking them first.

## Quirks

- A scan's list appears about 21 minutes after the scan starts; the feed waits 25. A scan still
  missing two hours after it was due is a gap in the satellite record and is passed over.
- The list states pixel centres to 0.01°. Mainland pixels are kept by a 33-point Natural Earth outline
  of the country, so a pixel within a few kilometres of the Spanish border may fall either side;
  Madeira and the Azores are kept by a box around each.
- The detections product holds the scans the last collection read and is replaced by the next; every
  detection stays in history. The activity series has a point per scan and region, zero when nothing
  burned, so a quiet scan is told apart from a missing one.
