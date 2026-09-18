# Working on open-data.pt

Read `.agents/skills/write-gatekeeper/SKILL.md` before touching a Gatekeeper, and `CONTEXT.md` for the vocabulary. `CONTRIBUTING.md` says the same as this file at more length, for people.

## Where things live

```
packages/gatekeeper-shared/src/           the contract, the shared collector, HTTP/stream/schema helpers
packages/gatekeeper-shared/src/formats/   arcgis  ckan  opendatasoft  gtfs  gbfs  udata  ogc
packages/gatekeeper-shared/src/sources/   carris  metrolisboa  ipma  dgeg  ine  ren  omie  bpstat  eurostat  parliament  ioda  ripestat  peeringdb
packages/gatekeeper-<library>/            generated: one Worker per library (arcgis  bpstat  carris  ckan  dgeg  eurostat  gbfs  gtfs  ine  ipma  metrolisboa  ogc  omie  opendatasoft  parliament  ren  udata)
apps/kernel/                              storage, history, the API and the site
tests/                                    every test, with fixtures under tests/fixtures/
tools/                                    packages.ts (generates the Workers and the lists naming them), dev.ts, usage-report.ts
```

## The rules

Where code lives

1. A library per format: anything with a standard (GTFS, GBFS, ArcGIS, CKAN, Opendatasoft, uData) is parsed once, under `formats/`. A Worker never contains parsing.
2. A library per bespoke source, under `sources/`: Carris, Metro Lisboa, IPMA, DGEG, INE, REN, OMIE, BPstat, Eurostat, Parliament, IODA, RIPEstat, PeeringDB.
3. One Worker per library, named for **how** the data is read, never for what it is about or who publishes it. Topics overlap, so they cannot place a Worker: they are catalog tags only, from the vocabulary `TOPICS` in `packages/gatekeeper-shared/src/topics.ts`, in any number and any order. The Workers are generated: `pnpm packages:sync` writes `packages/gatekeeper-<library>/` for every library that has examples and no publication hold. Never edit a Worker package by hand.
4. A library's `worker.ts` declares its human name and what its Worker needs (vars with their values, secrets, R2 buckets, CPU limit) and builds the library from that Worker's environment. A held source (`packages/gatekeeper-shared/src/publication-holds.json`) gets no Worker and installs no examples until the hold is lifted.
5. Feed slugs never change: a feed's ID derives from its slug, so moving a feed between Workers keeps its history.

What a Worker sends

6. Only what the kernel reads; a field with one possible value is not a field.
7. Date rows by the source's clock, never by when we polled.
8. Publish each value once: no table and series of the same numbers.
9. History is per product, not per feed: positions and copies of other products keep none (`withoutHistory`).

How to contribute

10. New dataset from a known source: one example entry. New source on a known format: one example plus its host in the library's `worker.ts`. New bespoke source: a library under `sources/` with its `worker.ts` and fixture tests — `pnpm packages:sync` then gives it its own Worker. New format: a library under `formats/`. New catalog tag: a key in `TOPICS`.
11. Test against the real source with `LIVE_EXAMPLES=<slug>` before a pull request. Deploys and secrets are the owner's.

Every example configuration carries `source: "<library>"`; that key routes the feed inside its Worker and the library never sees it. No backwards compatibility: delete what should not exist.

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

`pnpm packages:sync` regenerates every library Worker, the root scripts and the kernel's service bindings; a test fails when the checked-in files drift from it (run `pnpm install` and `pnpm types` after it creates a Worker). `pnpm dev -- <library>` runs the kernel with one Gatekeeper, for example `pnpm dev -- ckan`.

## Constraints

- Oxfmt owns formatting: run `pnpm format` before committing; CI rejects unformatted files.
- The vendored anti-slop Oxlint rules are errors: no runtime `typeof`, no widening anonymous types, no `unknown` parameters or returns, no unsafe dictionary types, a `SAFETY:` comment before every type assertion.
- **No module mocking.** Inject a `fetcher` or a fixture; never stub a module.
- Match the existing test style: fixtures under `tests/fixtures/`, no network in unit tests.
- **Never deploy.** No `pnpm deploy`, `wrangler deploy`, `wrangler secret put`, or `infra/lake/provision.sh`. `pnpm deploy:dry-run` proves the bundle without touching Cloudflare.
- Never run `pnpm check`; it runs everything at once and this machine has little memory.
