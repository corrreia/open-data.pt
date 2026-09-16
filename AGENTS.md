# Working on open-data.pt

Read `.agents/skills/write-gatekeeper/SKILL.md` before touching a Gatekeeper, and `CONTEXT.md` for the vocabulary. `CONTRIBUTING.md` says the same as this file at more length, for people.

## Where things live

```
packages/gatekeeper-shared/src/           the contract, the shared collector, HTTP/stream/schema helpers
packages/gatekeeper-shared/src/formats/   arcgis  ckan  opendatasoft  gtfs  gbfs  udata  ogc
packages/gatekeeper-shared/src/sources/   carris  metrolisboa  ipma  dgeg  ine  ren  omie  bpstat  eurostat  parliament  ripestat  peeringdb
packages/gatekeeper-<topic>/              generated: one Worker per topic (cities  economy  energy  environment  government  health  mobility  society  telecom)
apps/kernel/                              storage, history, the API and the site
tests/                                    every test, with fixtures under tests/fixtures/
tools/                                    packages.ts (generates the Workers and the lists naming them), dev.ts, usage-report.ts
```

## The rules

Where code lives

1. A library per format: anything with a standard (GTFS, GBFS, ArcGIS, CKAN, Opendatasoft, uData) is parsed once, under `formats/`. A Worker never contains parsing.
2. A library per bespoke source, under `sources/`: Carris, Metro Lisboa, IPMA, DGEG, INE, REN, OMIE, BPstat, Eurostat, Parliament, RIPEstat, PeeringDB.
3. One Worker per topic, named for what the data is about, never for who publishes it or how (there is no `statistics` Worker). A feed runs in the Worker of its **first** topic, and the topics are `TOPICS` in `packages/gatekeeper-shared/src/topics.ts`. The Workers are generated: `pnpm packages:sync` writes each `packages/gatekeeper-<topic>/` from the feeds whose first topic it is and the deployment declarations of the libraries they use. Never edit a Worker package by hand; moving a feed between Workers is a change to its `topics`. Telecom is `gatekeeper-telecom`: INE's telecommunications indicators, with RIPEstat and PeeringDB wired in but held.
4. A library's `worker.ts` declares what any Worker carrying it needs (vars with their values, secrets, R2 buckets, CPU limit) and builds the library from that Worker's environment. A held source (`packages/gatekeeper-shared/src/publication-holds.json`) is wired into its topic Worker, but its examples are not installed until the hold is lifted.
5. Feed slugs never change: a feed's ID derives from its slug, so moving a feed between Workers keeps its history.

What a Worker sends

6. Only what the kernel reads; a field with one possible value is not a field.
7. Date rows by the source's clock, never by when we polled.
8. Publish each value once: no table and series of the same numbers.
9. History is per product, not per feed: positions and copies of other products keep none (`withoutHistory`).

How to contribute

10. New dataset from a known source: one example entry. New source on a known format: one example plus its host in the library's `worker.ts`. New bespoke source: a library under `sources/` with its `worker.ts` and fixture tests. New format: a library under `formats/`. New topic: a key in `TOPICS`. Then `pnpm packages:sync`.
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

`pnpm packages:sync` regenerates every topic Worker, the root scripts and the kernel's service bindings; a test fails when the checked-in files drift from it (run `pnpm install` and `pnpm types` after it creates a Worker). `pnpm dev -- <topic>` runs the kernel with one Gatekeeper.

## Constraints

- Oxfmt owns formatting: run `pnpm format` before committing; CI rejects unformatted files.
- The vendored anti-slop Oxlint rules are errors: no runtime `typeof`, no widening anonymous types, no `unknown` parameters or returns, no unsafe dictionary types, a `SAFETY:` comment before every type assertion.
- **No module mocking.** Inject a `fetcher` or a fixture; never stub a module.
- Match the existing test style: fixtures under `tests/fixtures/`, no network in unit tests.
- **Never deploy.** No `pnpm deploy`, `wrangler deploy`, `wrangler secret put`, or `infra/lake/provision.sh`. `pnpm deploy:dry-run` proves the bundle without touching Cloudflare.
- Never run `pnpm check`; it runs everything at once and this machine has little memory.
