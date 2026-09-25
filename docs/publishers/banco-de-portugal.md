# Banco de Portugal

Portugal's central bank. We read fourteen datasets from BPstat, their statistics API.

## Source

The `bpstat` library (`apps/gatekeeper/src/publishers/banco-de-portugal/bpstat/`) reads each dataset
whole, as JSON-stat, following BPstat's `next_page` links. Most datasets are one page; the consumer
price index is nine.

## Access

No credential. `bpstat.bportugal.pt` sits behind BPstat's own Cloudflare, so our requests pass
through their firewall and rate limits, not only ours.

## Quirks

**All fourteen feeds run together each morning.** From 25 September 2026, the consumer price index,
the one paginated dataset, failed every run in production as `upstream-error`. The same collection
succeeds from outside Cloudflare, and the other thirteen feeds kept succeeding. The host is paced at
one request a second (`minIntervalSeconds` in their `index.ts`) so that burst is spread out. Every
refused answer is now logged as `source_http_status`, with `cf-mitigated` when their Cloudflare
challenged us, which will say whether the pace was the fix.
