# Working on open-data.pt

Read `.agents/skills/write-publisher/SKILL.md` before adding or changing a publisher, a feed or a library, and `CONTEXT.md` for the vocabulary. `CONTRIBUTING.md` says the same as this file at more length, for people.

## Where things live

```
apps/gatekeeper/src/
  publishers/<publisher>/   everything about one publisher
    index.ts                who they are, the hosts their data is read from, and every feed of theirs
    feeds/<feed>.ts         one file per feed: what it is, its terms, and its own fetch, backfill and transform
    <library>/              shared code for their own API, when they have one (carris, ipma, snirh, …)
    logo.svg | logo.png     their mark, when we have one
  formats/<format>/         shared code for the standards many publishers use:
                            arcgis  ckan  gbfs  gtfs  myinfo  ngsi  ogc  opendatasoft  udata  wfs
  catalog/                  define.ts, the LICENCES and TOPICS vocabularies, the generated publisher index
  libraries.ts              the libraries the Gatekeeper Worker carries
  publisher-client.ts       the fetch every feed is handed: its publisher's hosts, pace and User-Agent
apps/kernel/                storage, history and the API; serves the site
apps/site/                  the site, built into the kernel's static assets
packages/contract/          what the two Workers say to each other: the RPC, the normalized stream, JSON helpers
packages/api/               the API's wire shapes, which the kernel builds and the site reads
packages/lisbon/            Europe/Lisbon wall-clock arithmetic
tests/                      a folder of tests beside the code each tests; tests/ at the root for what spans apps
tools/                      catalog-index.ts, test-publisher.ts, dev.ts, usage-report.ts
docs/                       architecture, libraries, api, development, and notes under publishers/ and feeds/
```

## The rules

Where code lives

1. Everything about a publisher is in their folder: who they are, their feeds, their logo, and the code only they need.
2. Shared code per format: anything with a standard (GTFS, GBFS, ArcGIS, CKAN, Opendatasoft, uData, OGC API Features, WFS, NGSI, MYINFO) is parsed once, under `formats/`, and a feed calls it from its own file. A source that carries many publishers is a format.
3. One Worker carries every library. A library is named for **how** the data is read, never for what it is about or who publishes it. `libraries.ts` lists them; a test holds every library folder (one with a `deployment.ts`) to being listed.
4. A library's `deployment.ts` declares its name and what it needs from the Worker (vars with their values, secrets, R2 buckets, CPU limit) and builds the library from the Worker's environment, its publishers' feed configurations and hosts, and the fetch it resolves feeds with.
5. A publisher's `sources` are the only hosts their feeds reach, through the client every feed's `fetch` is: it refuses other hosts and redirects to them, names open-data.pt in its `User-Agent` (or what a host's `userAgent` says, with a comment saying why), adds the query parameters a publisher asked for, and keeps a host's `minIntervalSeconds`. A library never sets its own `User-Agent`.
6. Every feed states its own `licence` (a key of `LICENCES`, or `source-terms`), `topics` (keys of `TOPICS`) and `attribution`. Feeds that share terms share a constant; nothing is inherited from the publisher.
7. Feed slugs never change: a feed's ID derives from its slug, and its resource key from its library, so nothing about the Worker or the folders is in its identity. `apps/gatekeeper/tests/fixtures/feed-identity.json` pins every one.
8. A publisher we may not republish yet carries `enabled: false` in their `index.ts`, with a comment saying what we are waiting for: their code ships and nothing of theirs is installed.

What a Worker sends

9. Only what the kernel reads; a field with one possible value is not a field.
10. Date rows by the source's clock, never by when we polled.
11. Publish each value once: no table and series of the same numbers.
12. History is per product, not per feed: positions and copies of other products keep none (`withoutHistory`).

How to contribute

13. New feed from a publisher or format we already read: a file under the publisher's `feeds/` and one line in their `index.ts`. New publisher: their folder, with `index.ts` and at least one feed, then `pnpm catalog`. New bespoke source: a library folder in the publisher's folder with its `deployment.ts` and fixture tests, listed in `libraries.ts`. New format: the same under `formats/`. New licence or topic: a key in `LICENCES` or `TOPICS`; a test rejects an unknown key and an unused entry. A source whose reading takes knowledge the code does not carry — a credential, a proxy, a permission, a pace, a habit of the source — also gets a page under `docs/publishers/` or `docs/feeds/`; those folders' READMEs say what a page holds and when not to write one.
14. Test a publisher with `pnpm test:publisher <key>`, and against the real source with `pnpm test:publisher <key> --live` (or `LIVE_EXAMPLES=<slug or publisher key>`) before a pull request. Deploys and secrets are the owner's.

`defineFeed(<LIBRARY>_DEPLOYMENT, …)` adds `source: "<library>"` to a feed's configuration; that key routes the feed inside the Worker and the library never sees it. No backwards compatibility: delete what should not exist.

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

A change to what the kernel and the Gatekeeper exchange, or to where their Wrangler configurations live, is not proven by the checks: run the new pair with `pnpm dev`, load the site's pages in a browser, and check the order the two Workers deploy in. Cloudflare's Workers Builds deploy each Worker on its own when a merge touches its watch paths.

`pnpm dev <library>` runs the kernel and the Gatekeeper carrying one library, for example `pnpm dev ckan`, so only its feeds are installed and polled locally. Each Worker gets its own `wrangler dev` session, which is the only way the selection reaches the Gatekeeper.

## Constraints

- Oxfmt owns formatting: run `pnpm format` before committing; CI rejects unformatted files.
- The vendored anti-slop Oxlint rules are errors: no runtime `typeof`, no widening anonymous types, no `unknown` parameters or returns, no unsafe dictionary types, a `SAFETY:` comment before every type assertion.
- **No module mocking.** Inject a `fetcher` or a fixture; never stub a module.
- Tests sit beside what they test, in a `tests/` folder with their fixtures under `tests/fixtures/`, and are type-checked. No network in unit tests.
- **Never deploy.** No `pnpm deploy`, `wrangler deploy`, `wrangler secret put`, or `infra/lake/provision.sh`. `pnpm deploy:dry-run` proves the bundle without touching Cloudflare.
- Never run `pnpm check`; it runs everything at once and this machine has little memory.
