# FCT | FCCN

FCCN, the unit of the Fundação para a Ciência e a Tecnologia that runs the national research and
education network, also runs GigaPIX, the Portuguese internet exchange point. We read the traffic
through GigaPIX that its statistics page draws.

## Source

The charts on [gigapix.pt's traffic statistics](https://gigapix.pt/en/technical/estatisticas-de-trafego/)
are iframes from Picasso, FCCN's network statistics service (`picasso.netop.fccn.pt/charts/gigapix/<mode>`).
Their script reads `/api/data/query?db=<database>&q=gigapix&m=<mode>&p=`, which the `picasso` library in
[their folder](../../apps/gatekeeper/src/publishers/fccn/) reads the same way: the yearly chart
(`db=ixp-hist`, a `sum_max` per UTC day) once a day, and the daily chart (`db=ixp`, a `sum_mean` per
five minutes over the last 24 hours) every six hours. That is six requests a day of about 15 KB each.

## Quirks

- **Undocumented.** The endpoint is what the chart's own script calls, not a published API; no key,
  no ETag or Last-Modified. A new chart layout could move it without notice.
- **Units, not meaning.** The chart's configuration says `unit: "bps"`, but neither it nor the page says
  what `sum` adds up or whether it counts one direction or both, so the feeds say so.
- **The yearly chart's caption is not its column.** The page captions it "Média de um 1 dia", but the
  answer carries only `sum_max`, which stands well above the highest five-minute mean of the same day:
  it is published as the daily peak.
- **The last bucket is under way.** Every answer ends with the bucket still being filled (today, or the
  current five minutes); it is left out until a later answer holds it whole.

## Licence

FCT states no licence for the statistics; the site's footer reads "© 2025 – FCT | FCCN, todos os
direitos reservados." FCT, I.P. is a public institute, and what a public body publishes may be reused
unless it states otherwise (Lei 26/2016, art. 21.º), so the feeds carry `source-terms`.
