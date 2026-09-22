# Running it

## Locally

```bash
pnpm install
pnpm types
pnpm dev                 # a catalog worth looking at: IPMA, DGEG, OMIE, Carris and USGS
pnpm dev ckan            # carrying CKAN alone, so only its feeds are installed and polled
pnpm dev ckan gtfs       # those two
pnpm dev all             # every library, all 283 feeds, every source we read
```

The site and the API are on <http://localhost:8787>, and on this machine's own address as well, so a
phone or another laptop on the network can open them. Nothing has to be installed by hand: the
Registry installs every example the Gatekeeper lists on its first alarm and keeps them in sync, a few
feeds per alarm, re-checking every 15 minutes. A session carrying one library installs that library's
feeds and retires the rest of the local state; a Gatekeeper that does not answer at all logs
`gatekeeper_unavailable` and retires nothing.

**What `pnpm dev` carries by default** is five libraries chosen to fill the pages rather than the
disk: five publishers, five sets of terms, four topics, and every kind of product — reference tables,
current state, an event log, time series and a summary — from sources whose answers are small.

**Nothing is collected more often than every half hour**, whatever a policy says: a cadence of a
minute is right for production and rude from a laptop left open. The freshness window moves with it,
so a slowed feed is not shown as late. `DEV_MIN_CADENCE_SECONDS=60 pnpm dev` restores the real
cadences when that is what you are working on.

### How the selection reaches the Worker

Each Worker runs in its own `wrangler dev` session — they find each other over the service binding,
as [Wrangler's multi-Worker guide](https://developers.cloudflare.com/workers/local-development/multi-workers/)
describes — because a command with two `--config` flags treats the first as the primary Worker and
gives it the command line's flags, so `--var GATEKEEPER_LIBRARIES` never reached the Gatekeeper. It
cannot travel in `apps/gatekeeper/.dev.vars` either: that Worker declares `secrets.required`, and
Wrangler then [loads only those keys](https://developers.cloudflare.com/workers/wrangler/configuration/#secrets-configuration-property)
from the file. `.dev.vars` is for the secrets a source needs, and `pnpm dev` never writes it.

## The checks

```bash
pnpm check
```

This runs Oxlint, generated-binding checks, strict TypeScript, unit and Worker-runtime tests
(including a real Workflow collection), and dry-run bundles for the kernel and the Gatekeeper. On a
small machine run the steps one at a time instead:

```bash
pnpm lint
pnpm format:check
pnpm types
pnpm types:check
pnpm typecheck
pnpm exec vitest run --maxWorkers=2
pnpm deploy:dry-run
```

Oxfmt owns formatting (`pnpm format`), and the repository lints with vendored anti-slop rules: no
runtime `typeof`, no widening anonymous types, a `SAFETY:` comment before every type assertion, no
module mocking. Unit tests use fixtures under `tests/fixtures/` and never touch the network.

Before a pull request, collect your example from the source it actually names:

```bash
LIVE_EXAMPLES=porto-bicycle-racks-feed pnpm exec vitest run tests/live-examples.test.ts --maxWorkers=1
```

A scale benchmark runs on demand, and consumption measurements are read-only:

```bash
SCALE_ROWS=1000000 npx vitest run tests/scale.test.ts
node tools/usage-report.ts --days 7
```

## Deploying

Provisioning and deployment are explicit actions, and they are the owner's: this repository does not
alter production resources on its own, and a contributor never runs them.

```bash
CATALOG_TOKEN=... infra/lake/provision.sh
pnpm run deploy
```

After a deploy the Registry picks up new, changed and removed examples by itself within 15 minutes:
new feeds are installed, changed ones keep their IDs and are reconfigured, and runners of feeds whose
example disappeared delete their serving objects and retire once their history is delivered. Durable
Object schemas are not migrated: a changed schema version resets that object and the sync reinstalls
its feeds. Existing lake history is kept.
