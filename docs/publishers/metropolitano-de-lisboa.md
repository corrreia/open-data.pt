# Metropolitano de Lisboa

The Lisbon metro operator. We read their EstadoServicoML API: line status, next-train waiting times,
station reference data, and headways.

## Source

The `metrolisboa` library (`apps/gatekeeper/src/publishers/metropolitano-de-lisboa/metrolisboa/`), four feeds:

| Feed                             | Cadence   | History                                                          |
| -------------------------------- | --------- | ---------------------------------------------------------------- |
| `metrolisboa-line-status-feed`   | 5 minutes | changes — every status change is a disruption starting or ending |
| `metrolisboa-waiting-times-feed` | 1 minute  | `latest` — a next-train time is a live reading, not history      |
| `metrolisboa-stations-feed`      | daily     | changes                                                          |
| `metrolisboa-headways-feed`      | daily     | changes                                                          |

## Access

Metro's API store issues an application's consumer key and secret; the Gatekeeper exchanges them for
one OAuth 2 client-credentials token per collection and keeps nothing between requests. They are the
`ML_CONSUMER_KEY` and `ML_CONSUMER_SECRET` secrets declared in the library's `deployment.ts`, set by
the owner with `wrangler secret put`.

The token endpoint is `https://api.metrolisboa.pt/oauth2/token`, on port 443, whose certificate chain
is complete.

## Quirks

**The gateway's data port sends an incomplete certificate chain.** Metro answers the actual queries on
port 8243, and a Worker refuses that handshake with error 526. So `METROLISBOA_API_ORIGIN` is
`https://lisboa-metro.open-data.pt`: our own proxied CNAME to `api.metrolisboa.pt`, with an origin rule
sending it to port 8243 and SSL mode "full". If Metro ever fixes their chain, the var goes back to
their hostname and the DNS record and origin rule can go.

That proxy is Cloudflare configuration, not code: it is not in this repository, and a fresh account
would have to recreate it.

**At night the waiting times are code 404.** When the network closes (trains run from 06:30 to
01:00, Lisbon time), the gateway first answers an empty list for the waiting times, then, from about
01:40 until the first trains, `{"codigo":"404"}`. Between 01:10 and 06:20 the waiting-times feed takes
that one answer as an empty snapshot. Every other failure still fails it, day or night: the token, the
connection, an HTTP status, another code. So does the same 404 while trains run.
