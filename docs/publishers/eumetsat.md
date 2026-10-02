# EUMETSAT

The European Organisation for the Exploitation of Meteorological Satellites, which runs the Meteosat
satellites. Read through its Data Store with a registered account.

## Source

EUMETSAT's Data Store (`api.eumetsat.int`), read by the `datastore` library in
`apps/gatekeeper/src/publishers/eumetsat/datastore/`:

- **Active Fire Monitoring**, `EO:EUM:DAT:0801`, from Meteosat Third Generation's first imaging
  satellite, MTG-I1: one Common Alerting Protocol (CAP 1.1, XML) message per 10-minute scan of the
  whole disk, listed about 8 to 20 minutes after the scan ends, some tens of kilobytes (about 100 KB
  at the height of a fire season). Each message holds two `info` blocks, the fires the algorithm finds
  `Likely` and those it finds `Possible`, each fire a `circle` of "latitude,longitude radius" in km:
  the pixel, about 1.3 km in radius over Portugal. CAP carries no fire radiative power; the same
  product with it is `EO:EUM:DAT:0682`, in netCDF. The archive starts on 3 July 2025.
- **Not read yet:** the Lightning Imager's flashes, `EO:EUM:DAT:0691` (LI-2-LFL), every flash on the
  full disk in 10-minute granules of a few hundred kilobytes of NetCDF-4, which a Worker needs an HDF5
  reader for. It would cover the Azores, which IPMA's lightning page leaves out.

Fires are kept where they fall on Portugal with `apps/gatekeeper/src/portugal.ts`.

## Access

Searching the Data Store needs no account (`/data/search-products/1.0.0/os?pi=<collection>`, in scan
order with `sort=start,time,1`; `dtstart` matches every scan that ends at or after it). Downloading a
product's file (`/data/download/1.0.0/collections/<collection>/products/<product>/entry?name=<file>`)
takes an OAuth 2 token, from `POST /token` with the account's consumer key and secret
(`https://api.eumetsat.int/api-key/`). The Gatekeeper takes them as the secrets
`EUMETSAT_CONSUMER_KEY` and `EUMETSAT_CONSUMER_SECRET`; the account is the owner's. Registering for
EUMETCast, EUMETSAT's satellite broadcast, is not needed: the same Earth Observation Portal account
gives the key.

The API answers `429 Maximum number of connections exceeded` to a handful of parallel requests, so
the publisher's host keeps a second between requests.

**Not through `mf2.ipma.pt`.** IPMA publishes the LSA SAF fire lists (MSG FRP-PIXEL) there, but it
answers `403 Forbidden` to Cloudflare's network; see [IPMA](ipma.md). A feed reading it failed every
run in production on 2026-10-01 and was removed.

## Licence

EUMETSAT's Data Policy (last amended 25 November 2025) classes every Derived Product as **Core**:
"Free and Unrestricted basis under a CC-BY-4.0 licence", redistribution included. Derived Products
are the typically Level 2 products that hold none of the original numerical data, including
everything the SAFs generate. The Lightning Imager's and the active-fire Level 2 products are both
Core. Only Level 1 data under an hour old is "Recommended" and restricted. The attribution the policy
asks for is "[Contains modified] EUMETSAT [Meteosat/Metop] [data/product] [Year]".
