# Assembleia da República

The Portuguese parliament. Their open-data page publishes the whole XVII legislature as a handful of
large XML and JSON documents; we read seven of them.

## Source

The `parliament` library (`packages/gatekeeper-shared/src/sources/parliament/`), one feed per
document, all under the `parlamento-dados-abertos` licence and attributed
"Assembleia da República — Dados Abertos":

| Feed                                         | What it carries                                                                  | Cadence |
| -------------------------------------------- | -------------------------------------------------------------------------------- | ------- |
| `parliament-members-xvii-feed`               | Published mandates, constituencies, groups and sessions                          | daily   |
| `parliament-professional-profiles-xvii-feed` | Professional qualifications, roles and works                                     | weekly  |
| `parliament-petitions-xvii-feed`             | Petition headlines, status, signature counts                                     | daily   |
| `parliament-diplomas-xvii-feed`              | Approved legislation with official identifiers and text links                    | daily   |
| `parliament-activities-xvii-feed`            | Hearings, audiences, debates, visits and events                                  | daily   |
| `parliament-committees-xvii-feed`            | Committees, plenary sittings, and attendance with the absence reason they record | daily   |
| `parliament-initiatives-xvii-feed`           | Every initiative, each procedural step, and every vote by parliamentary group    | daily   |

Nothing is restricted to currently active members: the documents publish every mandate, including
renounced ones, and we say so rather than filtering. Personal submissions, birth dates, sex and
private contacts are not republished.

## Access

Public, no credentials. The legislature is part of each feed's configuration (`legislature: "XVII"`),
so a new legislature is new feeds with new slugs, not a change to these.

## Quirks

**Their download server sends no validators.** No ETag, no useful `Last-Modified`, so nothing tells us
a 93 MB document is the one we already read. Each document is staged in the
`open-data-pt-gatekeeper-staging` R2 bucket (binding `PARLIAMENT_STAGING`) and its R2 MD5 compared
with the last collection's; an unchanged file is never parsed. One object per file, overwritten on
every collection — a lifecycle rule may expire them and the next collection stages again.

**Initiatives is 93 MB.** About 5 seconds of CPU just to tokenise, plus normalisation, so the library
declares `cpuMs: 120_000` and the feed a 600-second timeout and 32 MB of output. Measured for XVII:
35 seconds to download and read live, 19,491 rows.

**Votes are recorded by group, not by member.** Named members appear only where they voted apart from
their group, and head counts only where Parliament gives them. Unanimous votes and some procedural
committee votes carry no per-group detail at all, so their position lists are empty. That is the
source, not a gap in the collection.
