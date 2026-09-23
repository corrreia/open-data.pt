# Libraries

A library is the code that reads one thing: a **format** with a standard, under
`apps/gatekeeper/src/formats/`, or one bespoke **source** API, which lives in its publisher's folder,
`apps/gatekeeper/src/publishers/<publisher>/<library>/`. It is named for _how_ the data is read, never
for what it is about: topics overlap, and a publisher may be read two ways (Carris through its own API
and through GTFS), so a topic is never a code boundary.

`apps/gatekeeper/src/libraries.ts` lists the libraries the Gatekeeper Worker carries.
Adding one is its directory and one line in that list; a test holds every library directory to being
listed there.

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

## Publishers held back

Source access, validation and permission to republish are separate checks. A publisher we may not
republish yet carries `enabled: false` in
their folder's `index.ts` under [`apps/gatekeeper/src/publishers/`](../apps/gatekeeper/src/publishers/), with a comment saying
what we are waiting for. None of their feeds is installed, so nothing of theirs is polled or served.
The library that reads them still ships: a hold is about whose data we serve, not about what code
exists. Lifting a hold is deleting one word.

| Publisher   | Read by                 | Held because                                                                                            |
| ----------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `ripe-ncc`  | `ripestat`, `ripeatlas` | Service terms Articles 3.3 and 3.5 bar repackaging and redistribution; Atlas adds written authorisation |
| `peeringdb` | `peeringdb`             | The acceptable-use policy requires permission for reproduction and bulk sharing                         |
| `ioda`      | `ioda`                  | Georgia Tech reserves all rights, and several signals IODA blends carry their own redistribution bars   |

The consistency tests require every library directory to be listed in `libraries.ts`, every example
tag to be a known catalog topic, and nothing of a held publisher's to be installed.

A successful source request is not proof of a reuse licence, and a successful dry-run is not a
deployment.

## Publishers, datasets and the vocabularies they name

Every publisher is a folder, [`apps/gatekeeper/src/publishers/<publisher>/`](../apps/gatekeeper/src/publishers/),
and everything about them is in it:

- **`index.ts`** — who they are: never the portal the data was read from, since dados.gov.pt carries
  ten publishers and is none of them. A publisher read through two libraries is one publisher, with
  one folder and one page.
- **`logo.svg` or `logo.png`** — their mark, optional; see [the publishers README](../apps/gatekeeper/src/publishers/README.md).
- **`datasets/<name>/`** — one publisher's body of data: `index.ts` says what it is, its terms and its
  topics, and every other file is one feed, with the functions that read it — `fetch` for the live
  read, `backfill` for the history walk when the source keeps one, and `transform` — each calling
  shared code. Two feeds are the same dataset when they describe the same things, by the same
  identifiers, under the same terms. The key is the folder and the dataset's name,
  `<publisher>-<name>`, and never changes.
- **`<library>/`** — shared code for their own API, when they have one: how a feed's identity is worked
  out, what its feeds are handed when they run, and the fetching and translating their files call.

Two keyed lists every dataset names, in [`apps/gatekeeper/src/catalog/`](../apps/gatekeeper/src/catalog/):

- **`topics.ts`** — browsing tags. A dataset carries as many as it likes: `cities`, `culture`, `economy`,
  `energy`, `environment`, `government`, `health`, `mobility`, `society`, `telecom`, `weather`.
- **`licences.ts`** — the terms a dataset is served under, as its publisher states them, or
  `source-terms` when they state none. A licence spelled three ways is one licence.

The Worker's bundler cannot list a directory, so `pnpm catalog` writes the folders down in
`catalog/folders.generated.ts`, and a test fails when it is stale. The Gatekeeper hands the catalog
to the kernel over RPC; the kernel stores it and serves it expanded, each vocabulary entry as
`{ id, name, url?, description? }` and each dataset at `/api/datasets`. A licence or topic nothing
uses, a publisher with no dataset, and a dataset no feed reads all fail the tests.

## Writing one

[`../CONTRIBUTING.md`](../CONTRIBUTING.md) walks through each kind of contribution, and
[`../.agents/skills/write-gatekeeper/SKILL.md`](../.agents/skills/write-gatekeeper/SKILL.md) is the
same for coding agents. A library exports its feed-kind table, its validator, its collect function,
its transformer, a collector factory, and the deployment declaration that says what the Worker must
give it. Which feeds it reads is the publishers' word, in their dataset files.
