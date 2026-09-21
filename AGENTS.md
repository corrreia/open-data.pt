# Working on open-data.pt

Read `.agents/skills/write-gatekeeper/SKILL.md` before touching a Gatekeeper, and `CONTEXT.md` for the vocabulary. `CONTRIBUTING.md` says the same as this file at more length, for people.

## Where things live

```
packages/gatekeeper-shared/src/           the contract, the shared collector, HTTP/stream/schema helpers
packages/gatekeeper-shared/src/formats/   arcgis  ckan  opendatasoft  gtfs  gbfs  udata  ogc  wfs  stac
packages/gatekeeper-shared/src/sources/   carris  metrolisboa  ipma  dgeg  ine  ren  omie  bpstat  eurostat  parliament  myinfo  firms  nasapower  usgs  anepc  ioda  ripeatlas  ripestat  peeringdb  snit
packages/gatekeeper-shared/src/libraries.ts  the libraries the Gatekeeper Worker carries
packages/gatekeeper/                      the Gatekeeper Worker: every listed library behind one private RPC binding
apps/kernel/                              storage, history, the API and the site
tests/                                    every test, with fixtures under tests/fixtures/
tools/                                    dev.ts, usage-report.ts
```

## The rules

Where code lives

1. A library per format: anything with a standard (GTFS, GBFS, ArcGIS, CKAN, Opendatasoft, uData, OGC API Features, WFS, STAC) is parsed once, under `formats/`. A Worker never contains parsing.
2. A library per bespoke source, under `sources/`: Carris, Metro Lisboa, IPMA, DGEG, INE, REN, OMIE, BPstat, Eurostat, Parliament, NASA FIRMS, NASA POWER, USGS, ANEPC, IODA, RIPE Atlas, RIPEstat, PeeringDB, SNIT.
3. One Worker carries every library. A library is named for **how** the data is read, never for what it is about or who publishes it. Topics overlap and a publisher may be read two ways, so neither is a code boundary. What the catalog groups by is three keyed vocabularies in `packages/gatekeeper-shared/src/`: `TOPICS` (tags, any number and order), `PUBLISHERS` (who made the data, never the portal it was read from) and `LICENCES` (the terms stated, or `source-terms`); every example names a key of each, and the API serves them expanded as `{ id, name, url?, description? }`. `libraries.ts` lists the libraries the Worker carries; a test holds every library directory to being listed or held.
4. A library's `deployment.ts` declares its human name and what it needs (vars with their values, secrets, R2 buckets, CPU limit) and builds the library from the Worker's environment. A held source (`packages/gatekeeper-shared/src/publication-holds.json`) is not listed: its code does not ship and its examples are not installed until the hold is lifted.
5. Feed slugs never change: a feed's ID derives from its slug, and its resource key from its library, so nothing about the Worker is in its identity.

What a Worker sends

6. Only what the kernel reads; a field with one possible value is not a field.
7. Date rows by the source's clock, never by when we polled.
8. Publish each value once: no table and series of the same numbers.
9. History is per product, not per feed: positions and copies of other products keep none (`withoutHistory`).

How to contribute

10. New dataset from a known source: one example entry. New source on a known format: one example plus its host in the library's `deployment.ts`. New bespoke source: a library under `sources/` with its `deployment.ts` and fixture tests, listed in `libraries.ts`. New format: a library under `formats/`, listed the same way. New topic, publisher or licence: a key in `TOPICS`, `PUBLISHERS` or `LICENCES`; a test rejects an unknown key and an unused entry. A publisher's mark is optional: their logo file under `apps/site/public/publishers/`, named for their key, and `logo` naming its extension — `apps/site/public/publishers/README.md` says what a usable one is, and a publisher without one keeps their initials.
11. Test against the real source with `LIVE_EXAMPLES=<slug>` before a pull request. Deploys and secrets are the owner's.

Every example configuration carries `source: "<library>"`; that key routes the feed inside the Worker and the library never sees it. No backwards compatibility: delete what should not exist.

## Checks

Run them in this order, in the foreground, one at a time:

```bash
pnpm lint
pnpm format:check
pnpm types
pnpm types:check
pnpm typecheck
pnpm exec vitest run --maxWorkers=2
pnpm deploy:dry-run
```

`pnpm dev -- <library>` runs the kernel and the Gatekeeper carrying one library, for example `pnpm dev -- ckan`, so only its feeds are installed and polled locally.

## Constraints

- Oxfmt owns formatting: run `pnpm format` before committing; CI rejects unformatted files.
- The vendored anti-slop Oxlint rules are errors: no runtime `typeof`, no widening anonymous types, no `unknown` parameters or returns, no unsafe dictionary types, a `SAFETY:` comment before every type assertion.
- **No module mocking.** Inject a `fetcher` or a fixture; never stub a module.
- Match the existing test style: fixtures under `tests/fixtures/`, no network in unit tests.
- **Never deploy.** No `pnpm deploy`, `wrangler deploy`, `wrangler secret put`, or `infra/lake/provision.sh`. `pnpm deploy:dry-run` proves the bundle without touching Cloudflare.
- Never run `pnpm check`; it runs everything at once and this machine has little memory.
