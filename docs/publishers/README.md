# Publishers

A **publisher** is who made the data — one key of
[`packages/gatekeeper-shared/src/publishers.ts`](../../packages/gatekeeper-shared/src/publishers.ts)
per institution or operator, never the portal the data was read from. The live list, with a page each,
is at [open-data.pt/publisher/](https://open-data.pt/publisher/).

This folder is for the knowledge that does not fit in the code: how a publisher's source is reached,
what had to be arranged with them, and what to expect when it breaks. **Most publishers need no page.**
Write one when reading their data takes something a reader of `examples.ts` would not guess — a
credential, a proxy, an unusual cadence, a permission, a known habit of the source.

## Pages

| Publisher                                             | Why it has a page                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| [Metropolitano de Lisboa](metropolitano-de-lisboa.md) | OAuth credentials, and a proxy hostname their TLS chain forces on us           |
| [Assembleia da República](assembleia-da-republica.md) | 93 MB documents with no validators, staged in R2 and compared by hash          |
| [Carris Metropolitana](carris-metropolitana.md)       | Read through two libraries, and positions that must not become history         |
| [The Card4B MYINFO operators](card4b-operators.md)    | Four publishers on one shared platform, allowlisted by folder                  |
| [APA](apa.md)                                         | Read through three libraries split so no value repeats, and a site with no API |

## Writing one

Name the file for the publisher's key, so `publishers.ts` and the folder line up, and add it to the
table above. Keep it to what is true and checkable:

```markdown
# <Publisher name>

Who they are, in a line, and what we read from them.

## Source

Where the data lives, which library reads it, and which feeds.

## Access

Credentials, allowlists, proxies, rate limits — and where each one is declared. Never the secret itself.

## Quirks

What surprised us: encodings, clocks, caps, silent failures, and what the code does about them.

## Permission

What they were asked, what they answered, and when. A hold in `publication-holds.json` belongs here too.
```

Their mark is separate: the logo file goes under
[`apps/site/public/publishers/`](../../apps/site/public/publishers/) named for the key, and `logo` in
`publishers.ts` names its extension. A publisher without one is shown their initials.
