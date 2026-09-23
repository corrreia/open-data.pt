# RIPE NCC

The Regional Internet Registry for Europe, the Middle East and parts of Central Asia. We read what
RIPEstat publishes about Portugal's share of the internet: the address blocks and networks registered
here, and how they are routed.

## Source

RIPEstat (`stat.ripe.net`), read by the `ripestat` library in
[their folder](../../apps/gatekeeper/src/publishers/ripe-ncc/): the seven feeds of _Portugal's internet
resources_. Five routing-status feeds run every 8 hours, to catch each of RIPE's snapshots at 00:00,
08:00 and 16:00 UTC; the other two run daily. That is about 17 requests a day, plus a one-off
routing-history backfill of about 120 requests, at least 20 seconds apart.

## Access

No key. The host is declared in `sources` in the publisher's `index.ts`, which is also where every
request gets `sourceapp=open-data.pt`, as RIPE NCC asked.

## Permission

RIPE NCC's terms of service (Articles 3.3 and 3.5) bar re-packaging and redistributing their data
without permission, so RIPEstat was held until we asked. Sam van Kampen, RIPE NCC, answered on
21 September 2026:

> This use of the data is certainly allowed - ToS section 3.3 speaks specifically about commercial use,
> so I don't think your use would fall under it.
>
> This query volume should certainly not be an issue - if you could include a sourceapp parameter in
> your queries (e.g. "sourceapp=open-data.pt") that would be appreciated just so we get a better
> picture of how the APIs are used.

The licence stays `ripestat-terms`: the terms still apply, and this answer is our permission under them.
