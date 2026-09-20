# Running it

## Locally

```bash
pnpm install
pnpm types
pnpm dev                 # the kernel and the Gatekeeper, carrying every library
pnpm dev -- ckan         # carrying CKAN alone, so only its feeds are installed and polled
```

Nothing has to be installed by hand: the Registry installs every example the Gatekeeper lists on its
first alarm and keeps them in sync, a few feeds per alarm, re-checking every 15 minutes. A session
carrying one library installs that library's feeds and retires the rest of the local state; a
Gatekeeper that does not answer at all logs `gatekeeper_unavailable` and retires nothing.

The selection goes to `packages/gatekeeper/.dev.vars` as `GATEKEEPER_LIBRARIES`.

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
