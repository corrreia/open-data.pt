# Working on open-data.pt

Read `.agents/skills/write-gatekeeper/SKILL.md` before touching a Gatekeeper, and `CONTEXT.md` for the vocabulary. `CONTRIBUTING.md` says the same as this file at more length, for people.

## Where things live

```
packages/gatekeeper-shared/src/           the contract, the shared collector, HTTP/stream/schema helpers
packages/gatekeeper-shared/src/formats/   arcgis  ckan  opendatasoft  gtfs  gbfs  udata  ogc
packages/gatekeeper-shared/src/sources/   carris  metrolisboa  ipma  dgeg  ine  ren  omie  bpstat  eurostat  parliament  ripestat  peeringdb
packages/gatekeeper-<topic>/              cities  economy  energy  environment  government  health  mobility  society  telecom
apps/kernel/                              storage, history, the API and the site
tests/                                    every test, with fixtures under tests/fixtures/
tools/                                    packages.ts (generated lists), dev.ts, usage-report.ts
```

## The rules

Where code lives

1. A library per format: anything with a standard (GTFS, GBFS, ArcGIS, CKAN, Opendatasoft, uData) is parsed once, under `formats/`. A Worker never contains parsing.
2. A library per bespoke source, under `sources/`: Carris, Metro Lisboa, IPMA, DGEG, INE, REN, OMIE, BPstat, Eurostat, Parliament, RIPEstat, PeeringDB.
3. One Worker per topic, named for what the data is about, never for who publishes it or how (there is no `statistics` Worker). A Worker is wiring: its libraries, its vars and secrets, its example feeds. A feed lives in a Worker whose topic its `topics` carry (INE and Eurostat select by first topic); a library several topics need is wired into each. The publisher is a label on each feed, shown on the site; it is not a code boundary. Telecom is `gatekeeper-telecom`: INE's telecommunications indicators, with RIPEstat and PeeringDB wired in but held.
4. A held source (`research/source-publication-holds.json`) is wired into its topic Worker, but its examples stay out of that Worker's `examples.ts` until the hold is lifted.
5. Feed slugs never change: a feed's ID derives from its slug, so moving a feed between Workers keeps its history.

What a Worker sends

6. Only what the kernel reads; a field with one possible value is not a field.
7. Date rows by the source's clock, never by when we polled.
8. Publish each value once: no table and series of the same numbers.
9. History is per product, not per feed: positions and copies of other products keep none (`withoutHistory`).

How to contribute

10. New dataset from a known source: one example entry. New source on a known format: one example plus vars. New bespoke source: a library under `sources/` with fixture tests, wired into the Worker of its topic; a topic with no Worker yet gets a new `packages/gatekeeper-<topic>/`. New format: a library under `formats/`.
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

`pnpm packages:sync` regenerates the root scripts and the kernel's service bindings; a test fails when the checked-in files drift from it. `pnpm dev -- <topic>` runs the kernel with one Gatekeeper.

## Constraints

- Oxfmt owns formatting: run `pnpm format` before committing; CI rejects unformatted files.
- The vendored anti-slop Oxlint rules are errors: no runtime `typeof`, no widening anonymous types, no `unknown` parameters or returns, no unsafe dictionary types, a `SAFETY:` comment before every type assertion.
- **No module mocking.** Inject a `fetcher` or a fixture; never stub a module.
- Match the existing test style: fixtures under `tests/fixtures/`, no network in unit tests.
- **Never deploy.** No `pnpm deploy`, `wrangler deploy`, `wrangler secret put`, or `infra/lake/provision.sh`. `pnpm deploy:dry-run` proves the bundle without touching Cloudflare.
- Never run `pnpm check`; it runs everything at once and this machine has little memory.
