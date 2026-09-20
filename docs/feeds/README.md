# Feeds

A **feed** is one repeatable collection: a library, a resolved source configuration, a policy, and a
slug that never changes. Everything the platform collects is described by an example feed in its
library's `examples.ts`; the Registry installs them and keeps them in sync, so adding a dataset is
adding an entry there.

This folder holds notes on individual feeds whose configuration needs explaining beyond the comment
next to it. Most feeds need none: [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) covers how to add
one, and [`../publishers/`](../publishers/) covers what is true of a whole publisher.

## Pages

| Feed                                           | Why it has a page                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| [Carris vehicle positions](carris-vehicles.md) | A worked example: one feed, five products, and what history it keeps |

## What an entry looks like

```ts
{
  slug: "porto-bicycle-racks-feed",          // never changes once merged
  title: "Porto bicycle racks",
  description: "Public bicycle parking published by Câmara Municipal do Porto.",
  config: { source: "ckan", host: "opendata.porto.digital", dataset: "estacionamento-bicicletas" },
  policy: {
    name: "…",
    version: 1,
    collection: { cadenceSeconds: 86_400, timeoutSeconds: 30, maxBytes: 8 * 1024 * 1024, historyMode: "changes" },
    serving: { licence: "cc0-1.0", attribution: "Câmara Municipal do Porto via dadosabertos.cm-porto.pt" },
  },
  staleAfterSeconds: 172_800,
  publisher: "cm-porto",
  topics: ["cities", "mobility"],
}
```

- **`slug`** decides the feed's ID, so renaming one throws its history away. Choose it once.
- **`config.source`** names the library that reads it, and is what routes it inside the Worker. The
  library never sees that key.
- **`policy.collection`** is how it is collected: `cadenceSeconds`, `timeoutSeconds`, the `maxBytes`
  the source may send, `maxOutputBytes` when the normalized form is larger than the default cap, and
  `historyMode` — `changes` to keep revisions, `latest` when a reading is out of date a minute later.
  `withoutHistory` names the products of this feed that keep none.
- **`policy.serving`** is how it is published: a `licence` key and the `attribution` line every
  response carries.
- **`staleAfterSeconds`** is when the site should call the data stale — usually a small multiple of
  the cadence.
- **`publisher`** and **`topics`** are catalog keys, not code boundaries. See
  [Libraries](../libraries.md#the-vocabularies-the-catalog-groups-by).

## Choosing a cadence

Poll as often as the data actually changes, and no more: every collection costs a request to the
publisher and a chance to write a revision nobody asked for. Carris alerts are posted days before the
disruption they announce, so 15 minutes catches everything; a metro line's status changes about three
times a day, so five minutes still catches a disruption while it matters. When a value is a live
reading rather than a fact — next-train times, vehicle positions — collect it often and keep no
history for it.

Three rules decide what a feed sends, and all three are about not publishing the same thing twice:

1. Only what the kernel reads; a field with one possible value is not a field.
2. Date rows by the source's clock, never by when we polled.
3. Publish each value once: no table and series of the same numbers. A series beside a table is
   allowed only when it carries something the table does not — a count, a median, a total per period.
