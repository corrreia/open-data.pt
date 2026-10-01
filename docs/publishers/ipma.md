# IPMA

Instituto Português do Mar e da Atmosfera, Portugal's weather, sea and seismic institute. We read ten
feeds from their open-data API and one, lightning, from their website.

## Source

The `ipma` library (`apps/gatekeeper/src/publishers/ipma/ipma/`) reads two hosts.

- `api.ipma.pt`: JSON and CSV files, one or a few per feed, re-read whole on every collection.
- `www.ipma.pt/pt/otempo/obs.dea/`: the lightning page (`lightning.ts`). It has no API behind it; the
  map's own script declares, as a JSON object, every discharge IPMA's detection network located in
  the last 24 hours. The feed reads that object out of the page.

## Access

No credential. IPMA is known to block heavy readers. The lightning page is one request every 15
minutes, which IPMA answers from its own cache (`X-Upstream-Cache: HIT`), and the feed sends
`If-Modified-Since` so an unchanged page costs it no body.

**`mf2.ipma.pt` refuses Cloudflare.** Their dataservices site (the "MF2" fire-weather portal, which
publishes the EUMETSAT LSA SAF products IPMA makes) answers `403 Forbidden` to requests from
Cloudflare's network, though it answers anywhere else and shares its server (193.137.20.123) with
`www.ipma.pt`, which does not refuse. A Meteosat fire feed read from it failed every run in production
on 2026-10-01 and was removed. Do not read mf2 from the Gatekeeper without IPMA allowing it; the same
kind of fire data is better read from EUMETSAT's Data Store.

## Quirks

- **The lightning page's note says its data is cut to 31.5–42.5°N and 19.5–5.5°W**, which would leave
  the Azores out, but its map reaches 35°W and IPMA's network covers the Azores; the note is taken as
  older than the network. The page also carries Spain and Morocco. The feed keeps the mainland by a
  33-point outline of the country and the islands by a box around each group
  (`apps/gatekeeper/src/portugal.ts`), and counts all three. If Azores hours stay at zero through a
  storm there, the note was right and their series should go.
- The page keeps 24 hours, refreshed in 10-minute steps, in UTC; its `update_date` carries no zone
  and is read as UTC. The hourly counts take only whole hours inside the last 23, so the hour at
  the window's edge is never counted half-empty and then overwritten.
- `amplitude` is the peak current in kA, with its sign; `icloud` true is a discharge between clouds,
  false one to the ground. IPMA states the data are informative and not official for incidents or
  accidents; the feed's description says so.
- If the page stops declaring `var data = {…}` before its `dea =` layer, the collection fails as
  `invalid-response` rather than reporting no lightning.
