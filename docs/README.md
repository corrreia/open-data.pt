# Documentation

The deep material that used to live in the root `README.md`. Each page stands on its own; start
wherever your question is.

## The platform

| Page                            | What it answers                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| [Architecture](architecture.md) | How a source becomes a product: the Gatekeeper, collection, storage, history and backfill |
| [Libraries](libraries.md)       | Every library the Gatekeeper carries, what it reads, and which sources are held back      |
| [Public API](api.md)            | Every endpoint, what it serves, and the rules that apply to all of them                   |
| [Running it](development.md)    | Local development, the checks, and what a deployment does                                 |

## Per source

| Folder                       | What lives there                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| [`publishers/`](publishers/) | A page per publisher that needs one: access, credentials, quirks, and what we agreed with them |
| [`feeds/`](feeds/)           | How a feed is defined, and notes on individual feeds whose configuration needs explaining      |

Most publishers need no page at all. One is written when reading their data takes knowledge that is
not in the code: a login, a proxy, a rate limit, a permission, a habit of the source.

## Elsewhere in the repository

- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — adding a dataset, a source or a format, and the checks before a pull request
- [`../CONTEXT.md`](../CONTEXT.md) — the domain language: Gatekeeper, library, feed, product, policy, lake, kernel
- [`../AGENTS.md`](../AGENTS.md) — the same rules, written for coding agents
- [`../.agents/skills/write-publisher/SKILL.md`](../.agents/skills/write-publisher/SKILL.md) — adding a publisher, a feed or a library, step by step
- [`../apps/gatekeeper/src/publishers/README.md`](../apps/gatekeeper/src/publishers/README.md) — what a usable publisher logo is

The site has its own reader-facing documentation: [Start here](https://open-data.pt/start/),
the [API reference](https://open-data.pt/docs) and the [OpenAPI document](https://open-data.pt/openapi.json).
