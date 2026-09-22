# Libraries

A library is the code that reads one thing: a **format** with a standard, under
`packages/gatekeeper-shared/src/formats/`, or one bespoke **source** API, under `sources/`. It is
named for _how_ the data is read, never for what it is about or who publishes it — topics overlap and
a publisher may be read two ways, so neither is a code boundary.

`packages/gatekeeper-shared/src/libraries.ts` lists the libraries the Gatekeeper Worker carries.
Adding one is its directory and one line in that list; a test holds every directory under `formats/`
and `sources/` to being listed there or held.

## What the Worker carries

Today, 23 libraries over 283 example feeds.

| Library        | Reads                              | Feeds |
| -------------- | ---------------------------------- | ----- |
| `arcgis`       | ArcGIS feature services            | 38    |
| `ckan`         | CKAN portals                       | 30    |
| `gbfs`         | GBFS bike-share feeds              | 14    |
| `gtfs`         | GTFS transit feeds                 | 9     |
| `ogc`          | OGC API Features services          | 3     |
| `opendatasoft` | Opendatasoft portals               | 57    |
| `udata`        | uData portals (dados.gov.pt)       | 13    |
| `wfs`          | OGC Web Feature Services           | 9     |
| `anepc`        | ANEPC civil-protection occurrences | 1     |
| `bpstat`       | BPstat, Banco de Portugal          | 14    |
| `carris`       | Carris Metropolitana               | 5     |
| `dgeg`         | DGEG fuel prices                   | 6     |
| `eurostat`     | Eurostat                           | 10    |
| `firms`        | NASA FIRMS thermal anomalies       | 3     |
| `ine`          | INE, Statistics Portugal           | 26    |
| `infoagua`     | InfoÁgua flood and drought alerts  | 2     |
| `ipma`         | IPMA weather and sea               | 10    |
| `metrolisboa`  | Metro Lisboa                       | 4     |
| `myinfo`       | Card4B MYINFO operator portals     | 8     |
| `nasapower`    | NASA POWER daily analysis          | 3     |
| `omie`         | OMIE electricity market            | 2     |
| `parliament`   | Assembleia da República            | 7     |
| `ren`          | REN electricity grid               | 8     |
| `snirh`        | SNIRH water resources              | 12    |
| `usgs`         | USGS earthquake catalog            | 3     |

The counts are the examples each library ships, not the products they produce: one feed often serves
several tables and series. The live numbers are on [the catalog](https://open-data.pt/catalog/) and in
[`/api/feeds`](https://open-data.pt/api/feeds).

## Sources held back

Source access, validation and permission to republish are separate checks. A library under a
publication hold is written and tested but not listed in `libraries.ts`: its code does not ship and
its examples are installed nowhere until the hold in
[`packages/gatekeeper-shared/src/publication-holds.json`](../packages/gatekeeper-shared/src/publication-holds.json)
is resolved.

| Library     | Held because                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| `ripestat`  | RIPEstat Service Terms Article 3.3 restricts repackaging and redistribution                           |
| `ripeatlas` | The same bar, plus Atlas terms requiring written authorisation to make its databases available        |
| `peeringdb` | The acceptable-use policy requires permission for reproduction and bulk sharing                       |
| `ioda`      | Georgia Tech reserves all rights, and several signals IODA blends carry their own redistribution bars |

The hold file carries the reasoning, the action that would lift it, and the references. The
consistency tests require every cleared library to have a Worker, every example tag to be a known
catalog topic, and no held example to be auto-published.

A successful source request is not proof of a reuse licence, and a successful dry-run is not a
deployment.

## The vocabularies the catalog groups by

Three keyed lists next to the libraries, each one a test holds every example to:

- **`topics.ts`** — browsing tags. A feed carries as many as it likes: `cities`, `culture`, `economy`,
  `energy`, `environment`, `government`, `health`, `mobility`, `society`, `telecom`, `weather`.
- **`publishers.ts`** — who made the data, never the portal it was read from: dados.gov.pt carries ten
  publishers and is none of them. A publisher read through two libraries is one publisher, with one
  page. Their mark is optional; see [`publishers/`](publishers/).
- **`licences.ts`** — the terms a product is served under, as its publisher states them, or
  `source-terms` when they state none. A licence spelled three ways is one licence.

A feed names its publisher and its policy names its licence by key; the API serves each expanded as
`{ id, name, url?, description? }`. A key outside the list, and an entry no example uses, both fail
the tests.

## Writing one

[`../CONTRIBUTING.md`](../CONTRIBUTING.md) walks through the four kinds of contribution, and
[`../.agents/skills/write-gatekeeper/SKILL.md`](../.agents/skills/write-gatekeeper/SKILL.md) is the
same for coding agents. A library exports its feed-kind table, its validator, its collect function,
its transformer, its examples array, a collector factory, and the deployment declaration that says
what the Worker must give it.
