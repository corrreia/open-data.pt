# Câmara Municipal de Águeda

The municipality's CKAN portal, `dadosabertos.cm-agueda.pt`: seven reference datasets (BeÁgueda
bike stations, charging points, electronics, textile and waste bins, flood marks, waste operators).

## Access

**Off since 11 November 2026** (`enabled: false` in `index.ts`). Since 24 September 2026 every
request from a Cloudflare Worker times out at the origin (522, after about 18 seconds), under our
User-Agent and under a browser's alike, while the portal answers a Portuguese connection at once.
The block is at the network, below HTTP, so nothing in a request changes it.

To lift it, the municipality has to let Cloudflare's addresses reach the portal. Most of the
datasets name UT-SIG, `dv-sig@cm-agueda.pt`, as maintainer; `geral@cm-agueda.pt` is the general
address. Once it answers, delete the `enabled: false` line.
