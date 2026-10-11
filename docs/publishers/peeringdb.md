# PeeringDB

The shared directory where networks, internet exchanges and data centres describe how they
interconnect. We read its public entries for the internet exchanges in Portugal.

## Source

PeeringDB's API (`www.peeringdb.com/api/`), read by the `peeringdb` library in
[their folder](../../apps/gatekeeper/src/publishers/peeringdb/): one feed, _Internet exchanges in
Portugal_, once a week. Only non-contact fields are kept — no emails, phone numbers or street
addresses.

## Access

No key. The host is declared in `sources` in the publisher's `index.ts`.

## Permission

PeeringDB's [acceptable-use policy](https://www.peeringdb.com/aup) requires permission for
reproduction and bulk sharing outside its approved operational uses, so PeeringDB was held until we
asked. Shawna Bong, PeeringDB Secretary/Treasurer, answered on 6 October 2026:

> After reviewing your use case we have determined that it does fall within our AUP. Please feel free
> to proceed.

The licence stays `peeringdb-aup`: the policy still applies, and this answer is our permission under
it. It covers the use case we described; a new kind of PeeringDB data is worth checking against it.
