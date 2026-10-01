# EUMETSAT

The European Organisation for the Exploitation of Meteorological Satellites, which runs the Meteosat
satellites. Not read yet: this page records what was established before the first feed, which waits
for a Data Store account.

## Source

EUMETSAT's Data Store (`api.eumetsat.int`), two collections from Meteosat Third Generation's first
imaging satellite, MTG-I1, over Portugal, Madeira and the Azores:

- **Lightning Imager flashes**, `EO:EUM:DAT:0691` (LI-2-LFL): every flash on the full disk, one
  granule per 10 minutes (about 560 KB, NetCDF-4), listed about 20 seconds after its window closes.
- **Active Fire Monitoring**, `EO:EUM:DAT:0801`, in CAP (Common Alerting Protocol, XML); the same
  product is also in netCDF as `EO:EUM:DAT:0682`. CAP is the one a Worker reads without an HDF5
  reader.

Fires and lightning would be kept where they fall on Portugal with `apps/gatekeeper/src/portugal.ts`.

## Access

Searching the Data Store needs no account (`/data/search-products/1.0.0/os?pi=<collection>`).
Downloading does: an OAuth token from a free EUMETSAT account's consumer key and secret
(`https://api.eumetsat.int/api-key/`), which the Gatekeeper would take as the secrets
`EUMETSAT_CONSUMER_KEY` and `EUMETSAT_CONSUMER_SECRET`.

**Not through `mf2.ipma.pt`.** IPMA publishes the LSA SAF fire lists (MSG FRP-PIXEL) there, but it
answers `403 Forbidden` to Cloudflare's network; see [IPMA](ipma.md). A feed reading it failed every
run in production on 2026-10-01 and was removed. Its code (an `lsasaf` library reading the scans'
point shapefiles, paced for IPMA) is in commit `49b58b0` if IPMA ever allows it.

## Licence

EUMETSAT's Data Policy (last amended 25 November 2025) classes every Derived Product as **Core**:
"Free and Unrestricted basis under a CC-BY-4.0 licence", redistribution included. Derived Products
are the typically Level 2 products that hold none of the original numerical data, including
everything the SAFs generate. The Lightning Imager's and the active-fire Level 2 products are both
Core. Only Level 1 data under an hour old is "Recommended" and restricted. The attribution the policy
asks for is "[Contains modified] EUMETSAT [Meteosat/Metop] [data/product] [Year]".
