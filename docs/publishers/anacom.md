# ANACOM

Autoridade Nacional de Comunicações, Portugal's communications and postal regulator. We read
fourteen of its market statistics and three layers of the universal postal service network.
**Held** (`enabled: false` in [their folder](../../apps/gatekeeper/src/publishers/anacom/)): see
[Permission](#permission).

## Source

**STAT.ANACOM** (`stat.anacom.pt`), read by the `dataverse` library in their folder. The site is
Microsoft Power Pages, and its Dataverse Web API answers anonymously. The open-data page lists about
97 indicator files. Each one is a row of `cr8db_stat_popupfileses` with a code (`cr8db_indicador`,
like `IndI_P064`) and two file columns. `cr8db_file` is the Portuguese ZIP and `cr8db_fileen` the
English one. A feed makes two requests a week. It looks up its indicator's row by code
(`$filter=cr8db_indicador eq '…'`), then fetches
`/_api/cr8db_stat_popupfileses(<id>)/cr8db_fileen/$value`, a ZIP holding one tab-separated UTF-8
CSV with a BOM. Each file holds the indicator's whole history: quarterly from 2018 T1 to the latest
quarter, so the first collection already has all of it.

**GEO.ANACOM** (`geo.anacom.pt`), read by the `arcgis` format. Three layers of the
`publico/ServicosPostais_Pub` MapServer (ArcGIS Server 11.3): post offices (layer 6, about 560),
postal agencies (layer 9, about 1,900) and street mail boxes (layer 4, about 10,700, in eleven
pages). Every row says when it was updated (`data_site`, "Final 2º Trimestre 2026"). The layers carry
no edit date, so each weekly run reads them whole. On purpose, we do not read:

- the coverage layers, which run to millions of rows;
- NET.mede and the drive tests;
- ITED/ITUR, which hold personal data;
- the municipal market-statistics layers (146–175 of `EstatisticasMercado_Pub`), which repeat the
  STAT files.

## Access

No credential. Both hosts are declared in `sources` in their `index.ts`. `stat.anacom.pt` is paced 3
seconds between requests, because all fourteen statistics feeds may come due together.
`geo.anacom.pt` is paced 1 second.

## Quirks

- **Every file is rebuilt every night**, around 03:50–04:00 UTC. That changes `modifiedon` and the ZIP's
  timestamps whether or not a number moved, and it may give a file a new record ID. So a feed looks
  the record up by its code every time, and never stores an ID. To tell whether anything changed, it
  hashes the inflated CSV, which makes an unchanged file `not-modified`.
- **`GrupoDimensao` says which breakdowns a row splits by.** A file mixes totals
  (`*(total geral)*`) with every breakdown and combination of breakdowns. A breakdown the row does
  not name is its total, whatever the cell says: usually `Total`, but sometimes empty, and in the
  revenue files `No associated service`. The series key is the breakdowns the row names, plus the
  operator in a market-share file. The operator's group (`Grupo_Prestador`) is kept as a dimension
  but is not part of the key, because operators change groups. NOWO has been in three.
- **Some rows name breakdowns the file has no column for.** Mobile accesses (`IndI_P068`) has eight
  such rows, split by number range, place of use and internet use. They cannot say what they count,
  so they are rejected and counted as rejected.
- **No units in the files.** Each feed states its own in `config.unit`. Shares are in percent and
  counts are accesses or subscribers. Revenues are in euros. Mobile data traffic is in gigabytes:
  `IndI_P089`, the average monthly traffic per access, is 20.7 for 2026 T2, which matches the 688.5
  million total over three months.
- **Retail revenues accumulate over the year.** `IndI_P123` is year-to-date at each quarter's end
  (2025 T4: 4.03 thousand million; 2026 T1: 0.99), so the fourth quarter is the whole year.
- The English files use a decimal point. The Portuguese ones use a decimal comma, and the parser
  reads either.

## Permission

STAT.ANACOM's [Termos e Condições](https://stat.anacom.pt/pt-PT/Termos-e-Condi%C3%A7%C3%B5es/)
(published 10/11/2025, updated 09/01/2026) say the same as the terms on
[www.anacom.pt](https://www.anacom.pt/render.jsp?categoryId=140985):

> Contudo, a ANACOM autoriza a cópia e distribuição da informação deste sítio, desde que: em todas as
> cópias seja feita referência ao documento original em www.anacom.pt; seja incluído o aviso relativo a
> direitos de autor: «Copyright © 2026 ANACOM. Todos os direitos reservados. Quaisquer direitos que não
> sejam expressamente concedidos são reservados»; a utilização desses materiais se destine
> exclusivamente a fins informativos e pessoais, e não comerciais. Esta autorização não contempla
> modificações ou utilizações derivadas e requer a notificação à ANACOM da sua utilização. É
> expressamente proibida a utilização de tais materiais para quaisquer outros fins, devendo qualquer
> tipo de utilização diverso ser previamente autorizado, por escrito, pela ANACOM.

Under our licensing rule, a non-commercial condition is acceptable. The bar on modifications and
derived uses is not, because normalizing the files into series is a derived use. The terms also ask
to be notified of any use. So ANACOM is held until it agrees. We will ask through
stat.suporte@anacom.pt, giving the indicators and layers above and the weekly pace, and record the
answer here. Every feed is under the `anacom-terms` licence, and its attribution carries the
reference to www.anacom.pt and the copyright notice word for word (`publishers/anacom/terms.ts`).
Lifting the hold means deleting `enabled: false`.
