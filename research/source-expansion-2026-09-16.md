# Source expansion: integration and operating notes

Implementation worktree: `/home/correia/open-data.pt-work/source-expansion-20260915`.

The expansion adds **84 reviewed feed definitions** to the existing topic Workers while preserving **170 original feed slugs**. Another **14 example definitions** belong to implemented adapters that remain inactive pending permissions or validation. It introduces no database migration, storage reset, public write endpoint, or new operator credential.

The [machine-readable release manifest](source-expansion-manifest.json) lists every added feed, exact source configuration and collection policy. [Explicit publication holds](source-publication-holds.json) keep the pending adapters out of all Worker install lists.

## Deployment status

**Deployed on 16 September 2026 after explicit owner approval.** The session gate initially refused the command despite successful dry-runs. The owner subsequently authorized deployment without another preview-review requirement, and all six existing Gatekeepers were deployed successfully. No kernel deployment, storage schema change, new Worker or secret replacement was performed.

Existing Wrangler OAuth authentication worked. The pre-existing Metro Lisboa secret names were verified after deployment and remained present. The publication holds for Parliament, RIPEstat and PeeringDB were not lifted.

Implementation and release changes are kept separate from unrelated local edits. The original checkout's unrelated work is not part of this change.

| Deployed Worker | Version |
|---|---|
| cities | `2c0af387-7291-46df-a36a-1c159d9eaaee` |
| energy | `7511249d-d08a-4673-88e3-246327caa851` |
| environment | `901e530a-ed27-4748-a7f3-bc3f071d4d3c` |
| health | `5a40c020-184f-4ecf-b78b-fc649c387390` |
| mobility | `b9072aac-ac10-4074-ad01-1adb5f6ab0ed` |
| statistics | `85e356fd-da7e-4123-b3e9-d187f6347fac` |

Wrangler reports no HTTP targets for these Workers because they are private RPC services. The deployed versions were updated by the owner-authorized, tested release repairs described below.

### Production verification and remaining upstream issues

The [production verification snapshot](source-expansion-production.json), taken on 16 September 2026 at 08:53 UTC, confirms:

| Production result | Count |
|---|---:|
| Registered feed definitions | 254 |
| New definitions registered | 84 |
| Original definitions missing | 0 |
| New feeds with a successful production collection | 74 |
| Held-source examples accidentally configured | 0 |
| New feeds awaiting upstream access/connectivity | 10 |

The remaining failures are not silently treated as empty datasets:

- **Eight Azores feeds:** production requests receive HTTP 403 with `cf-mitigated: challenge` from the publisher's Cloudflare protection. The same public interfaces work from the research environment. An honest identifying User-Agent did not resolve the edge refusal. No challenge bypass, clearance-token extraction or proxy workaround was attempted. Publisher-side API access approval or a supported machine-access endpoint is needed.
- **Two Águeda feeds:** textile-container and waste-operator metadata requests receive HTTP 522 origin-connection timeouts from Workers. Their public data and canonical dataset IDs were verified outside the edge, but the production origin route remains unavailable. This needs upstream connectivity recovery/support, not an invented zero-result snapshot.

The definitions remain present with their normal source-appropriate retry/collection policies. This report does not claim that all 84 sources are currently collectable from production.

### Production-only compatibility repairs

The owner explicitly authorized narrowly scoped Gatekeeper-only repairs after tests and previews, without further deployment confirmations. The kernel, storage, secrets and held sources were unchanged.

- Cloudflare's edge fetch rejected `redirect: "error"` even though Node-based source tests accepted it. IPMA and REN now use `manual` and explicitly reject non-success redirect responses. Added regression tests verify no redirect is followed. All new IPMA/REN feeds subsequently collected successfully, and the original IPMA feeds recovered too.
- Safe structured source diagnostics record host, path, HTTP status and challenge indicators, but not query strings, credentials or source response bodies.
- Policy revisions used the existing registry reconfiguration path to retry feeds whose initial attempts had already exhausted their retry window. No new operator endpoint or storage mutation was added.
- Águeda's affected feeds now use verified canonical dataset UUIDs, and CKAN/OGC requests identify the application transparently. This did not hide or bypass the remaining upstream failures.
- One complete INE income-history period exceeded the old 2 MiB historical-response budget. Historical collection now uses the same bounded 8 MiB source ceiling as live collection, while retaining the existing period-count selection. The real older slice returned 4,416 points after the repair; it no longer fails merely because a single reporting period cannot be split by date.

## Three-day status history follow-up

The status page now requests and displays three days of collection history on desktop and mobile. Incident history, accessible chart labels, the page description and the Markdown representation use the same shorter window. Older completed incidents are excluded from that view; ongoing incidents remain visible. Stored outage records and the API's supported historical range are unchanged.

This presentation change requires a kernel/site deployment because the kernel serves the built website and Markdown pages. It does not change storage schemas, retention, source publication holds or source retry scheduling. The separate recovery-retry and failure-label redesign discussed during source verification is not implemented in this change.

Browser checks confirmed the three-day request, three visible bars per timeline on desktop and mobile, filtering of old completed incidents, retention of ongoing incidents, and no mobile horizontal overflow. The full test suite passes after adding the status-history regression.

## Source acquisition frequency

Collection intervals are based on what the publisher produces, not on how often the public API can be called. A monthly dataset can contain hourly observations. Fetching it every minute would not make it live.

| Source family | Collection interval | Reason |
|---|---|---|
| CP, Fertagus, TUB Braga, TCB Barreiro, Horários do Funchal | Daily | Static transport-network and service-calendar files change through timetable releases and corrections. |
| Existing Bird Porto, Cascais and Matosinhos feeds | Five minutes | Useful current fleet snapshots without querying at every advertised cache expiry. Position/station revisions remain excluded from history. |
| IPMA municipal rain and temperature | Daily | The publisher updates a rolling daily-observation window. Municipal spatial means retain the source's daily date. |
| IPMA shellfish restrictions | Six hours | Changes follow published monitoring bulletins. Full and partial closures retain their species lists. |
| REN gas storage and LNG terminal balance | Daily | Source-dated daily reports. Unpublished days are skipped as missing, not manufactured as zero. |
| REN installed generating capacity | Weekly | Completed monthly reports, with recent completed months revisited for corrections. |
| Most new E-REDES monthly statistics | Weekly | Billed consumption, contracts and capacity are periodic releases, not live meters. |
| E-REDES reliability and large reference summaries | Thirty days | Annual statistics or relatively slow-changing inventories. |
| Banco de Portugal rates and Treasury yields | Daily | These are daily financial series. |
| Other Banco de Portugal additions | Weekly or thirty days | Monthly releases and quarterly company ratios do not justify minute polling. |
| Most SNS additions | Weekly | Monthly institutional reporting, including corrections and publication lag. |
| SNS daily declarations and procurement extract | Daily | Source-dated reporting windows; the extract's latest publication can lag real time. |
| SNS annual registers and explicitly historical datasets | Thirty days | Annual/archival material is clearly labelled rather than presented as current readings. |
| INE income, inequality and telecom statistics | Thirty days | Annual releases. Current NUTS 2024 indicators replace obsolete candidates. Telecom statistics include broadband accesses/penetration, household access, fixed-phone clients and traffic volume. |
| DGT mainland administrative reference tables | Weekly | Complete attributes-only tables, without oversized boundary outlines. |
| Small Azores environmental inventories | Weekly | Lighthouses, monitoring-station locations, waste operators and lagoons change relatively slowly. Station inventories are not sensor readings. |
| Larger Azores protected-area and geological layers | Thirty days | Complete source geometry, with bounded records and validated pagination. |
| CADA annual opinions | Thirty days | An explicitly historical annual table. |
| Recognised startup registry | Weekly | A periodically published reference registry. |
| IMPIC procurement notices and modifications | Weekly | Updating annual publication files. |
| IMPIC procurement entity register | Thirty days | A large cumulative reference snapshot, not a live company lookup. |
| Águeda reference inventories | Thirty days | Locations of assets and facilities, not live fill levels or vehicle availability. |
| Oeiras hourly environmental observations | Weekly | Hourly observations are distributed as monthly files. The newest reporting month is selected deterministically. |

The exact policies, source scopes and licences live beside the feed definitions. Historical source availability is separate from collection frequency. The kernel automatically starts a paced backfill for sources that declare a historical interface, so those paths also require verification.

## Important implementation decisions

- **Existing feeds are preserved.** The baseline inventory regression test checks every original slug and prevents accidental example removal from retiring production state. The pre-existing empty Bird Braga definition was not removed merely because research found no current vehicles.
- **Source identifiers remain identifiers.** Explicit uData key fields retain leading zeroes and alphanumeric values. Numeric-looking tax or registry identifiers are not converted into measures.
- **Source clocks are not polling clocks.** Daily observations, monthly periods and annual releases keep their own dates. Re-reading unchanged data does not create revisions just because acquisition time changed.
- **Missing reports are not zeroes.** REN's exact unpublished-date response is distinct from a valid zero flow. Null health and energy measurements stay missing.
- **Scopes are explicit.** Large source datasets use meaningful source-side aggregations or documented subsets rather than arbitrary first pages. No aggregate is advertised as a complete asset-location map.
- **Each value is published once.** Observation series are not duplicated as record tables. Reference inventories remain records. Conflicting unlabelled source figures must not be silently collapsed into a guessed latest revision.
- **Actual kernel limits apply to tests.** The live test harness uses the kernel's record-size ceiling instead of trusting a larger policy request.
- **GTFS coverage is described accurately.** The transport additions publish the static tables supported by the existing adapter, including network geography and service calendars. They do not add a live train-delay service or a new complete stop-times parser.
- **Geographic membership is checked.** The new OGC adapter validates page envelopes, counts, continuations and canonical identities. A changed or capped collection cannot silently become an authoritative truncated snapshot. Page-one validators are not used to skip possibly changed later pages.
- **Coordinate systems are not relabelled.** Geometry requests explicitly request CRS84. ETRS89 is not silently treated as WGS84. DGT's oversized outlines are omitted by the provider's documented parameter and the result is labelled as an attributes-only reference table.
- **Backfill budgets count normalized measures.** Source-row limits alone were insufficient for reliability data with several measures per row. Historical slices retain complete reporting cohorts while respecting the normalized-row ceiling.
- **Historical ambiguity is preserved.** Medical-training vacancy records can share year, institution and specialty but disagree in their figures. The source's unique record IDs are preserved in a record product rather than guessing or summing a revision.
- **No licence is invented.** E-REDES and identified municipal datasets retain their stated open licences. Publishers without stated dataset-level terms are labelled accordingly.

## Research corrections and exclusions

The research report was a candidate inventory, not a guarantee that every endpoint was current, newly configured, or unambiguous.

- The Bird feeds in Porto, Cascais and Matosinhos were already configured through helper-generated examples. They were verified and their cadence reviewed, not counted as new feed installations.
- INE indicator `0009940` stopped at 2021. The implementation uses current NUTS 2024 income and inequality series instead.
- IPMA's working evapotranspiration file stopped in June 2026. It was not enabled as a current daily feed.
- The separate Oeiras TOA5 station file lagged behind the research date and has logger-specific headers, units and clock semantics. The implemented Oeiras feed is the monthly publication of hourly environmental observations, not that station file.
- ANACOM's tested coverage services expose maps but reject feature queries. No supposedly working ANACOM record feed was added.
- Fogos.pt was rate-limited and EMEL access was denied during research. Neither was promoted as a verified source integration.
- Historical GPP market prices and old school directories were not relabelled as current feeds.
- GeoAPI's overlapping reference data and rate-limited lookup path were not added merely to increase the source count.

## Adapters awaiting permissions

| Adapter | Implemented examples | Reason it remains inactive |
|---|---:|---|
| Parliament | 6 | Synthetic normalization and public-directory discovery pass. The session gate denied complete real-record normalization, including aggregate-only verification, and required explicit authorization. Those operations were not rerouted through the parent or another agent. |
| RIPEstat | 7 | Keyless research checks pass, but [the service terms](https://www.ripe.net/about-us/legal/ripestat-service-terms-and-conditions) restrict repackaging and redistribution of its data. Permission for this public API must be established first. |
| PeeringDB | 1 | Keyless research checks pass, but [the acceptable-use policy](https://www.peeringdb.com/aup) restricts reproduction and bulk sharing outside approved uses. Intended republication needs clearance. |

These are code implementations, not newly active public feeds. They have no topic-Worker library-map entries, example-array inclusion or new deployment variables. The consistency tests enforce their exclusion. Removing a hold alone does not wire a source; the integration must also be reviewed and explicitly added.

The RIPEstat examples use the verified networks of MEO, NOS, Vodafone Portugal, DIGI-PT and NOS Madeira. Its documented routing snapshots occur at eight-hour intervals, so the proposed routing-summary cadence is eight hours, not every minute. Registration/routing timelines would be checked daily and the PeeringDB directory weekly. They are not customer outage or speed measurements. No NOWO network identity was guessed.

To provide usable government telecom data without those redistribution assumptions, the active additions include six INE indicators from the telecommunications and household-technology surveys. Their verified latest reporting year is 2025. These statistics are licensed through the existing INE publication path and require no API key.

## Credentials

No new source API key is required for the verified additions. The pre-existing Metro Lisboa integration still uses its existing consumer key and secret. Their names were checked without reading or changing their values.

Deployment permission is a separate requirement from those credentials.

## Validation evidence

Validation is performed in this order: repository lint, generated Worker types, generated-type consistency, TypeScript, the full test suite, and dry-run deployment. Live source tests are opt-in and validate normalized output using the kernel's frame reader. Additional source-only history tests exercise the first automatic backfill slice without writing to the lake or starting a production kernel.

Final results on 16 September 2026:

| Check | Outcome |
|---|---|
| Repository lint | Passed |
| Worker type generation and consistency | Passed |
| Full TypeScript check | Passed |
| Full test suite | 953 passed, 61 intentionally skipped; 82 files passed and 9 opt-in files skipped |
| Cleared new feeds, live source collection | 84 / 84 passed through the kernel frame validator |
| New Opendatasoft historical capabilities, first older slice | 26 / 26 passed; explicit exhaustion accepted where no older source scope exists |
| INE income historical slice after the production budget repair | Passed, 4,416 older points |
| Final build and dry-run deployment | Passed for every Gatekeeper and the kernel bundle |
| Production deployment | All six existing Gatekeepers deployed successfully after explicit owner approval |

The live and history checks made source reads only. They did not populate production storage or prove that a production backfill completed. Held Parliament record tests were not run. RIPEstat and PeeringDB remain excluded from automatic publication despite their separate research-only live checks.

The release manifest contains 84 new eligible definitions: cities 8, energy 14, environment 11, health 17, mobility 5, statistics 29. All 170 original feed slugs remain. Registry synchronization confirmed the resulting 254 production definitions. Successful deployment and registration are distinct from source availability; the production snapshot records the 74 successful initial collections and ten remaining upstream failures.

The kernel discovers the new Worker examples through its existing synchronization alarm. No bootstrap call, schema reset, new storage resource or secret replacement is part of this release.
