# Publisher marks

The logo of each publisher whose data this site republishes, shown beside their name
on the catalog, the publisher pages and every product page, and served from the API
as each publisher's `logo`. `PUBLISHERS` in `packages/gatekeeper-shared/src/publishers.ts`
says which publishers have one and with what extension; the file is named for the
publisher's key, so nothing else has to be stored. `tests/publisher-logos.test.ts` holds
the two lists to each other.

These are the publishers' trademarks. They are shown to name the institution that made
the data, no dataset licence covers them, and a publisher who asks for theirs to go only
has to ask. They are served from this site so that a visitor's browser never contacts a
third party to read a page.

## Taking one

Every file comes from the publisher's own site — their masthead, their stylesheet or
their brand page — never a logo aggregator or a redrawing. Prefer SVG, then PNG at
around twice the size it is drawn. A mark must

- be **full colour or dark**: it is drawn on a white tile, so a white-on-transparent
  variant disappears and is not used;
- be **at most eight times as wide as it is tall**, and ideally nearer square: the tile
  keeps one height and widens only so far, and a long lockup set in small type becomes a
  smudge at 40px. A publisher whose only mark is such a lockup keeps their initials, which
  read better — ANEPC, DGLAB, INE and SNS Transparência are there for that reason;
- **fetch nothing**: no `href` or `url()` to another host inside an SVG;
- stay **under 48 KB**.

When a publisher has both a symbol and a wordmark, take the one that still reads at 18px.

## Where each one came from

| Key                       | Publisher                          | Source                                                                                                                                                    |
| ------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apa`                     | APA                                | https://apambiente.pt/themes/custom/apa_theme/images/logo-apa.png                                                                                         |
| `banco-de-portugal`       | Banco de Portugal                  | https://www.bportugal.pt/themes/custom/bportugal/apple-touch-icon.png                                                                                     |
| `bird`                    | Bird                               | https://www.bird.co/favicon.svg                                                                                                                           |
| `cada`                    | CADA                               | https://www.cada.pt/images/LogoCADA_90_31_t.png                                                                                                           |
| `cm-agueda`               | Câmara Municipal de Águeda         | https://www.cm-agueda.pt/cmagueda/uploads/site_zone/favicon/1/favs.png                                                                                    |
| `cm-cadaval`              | Município do Cadaval               | https://www.cm-cadaval.pt/favicon/favicon.svg                                                                                                             |
| `cm-porto`                | Câmara Municipal do Porto          | https://www.cm-porto.pt/images/logos/logoazul.svg                                                                                                         |
| `cp`                      | CP                                 | https://www.cp.pt/favicon.svg                                                                                                                             |
| `dgeg`                    | DGEG                               | https://www.dgeg.gov.pt/Media/logo.png                                                                                                                    |
| `e-redes`                 | E-REDES                            | https://www.e-redes.pt/themes/custom/eredes_theme/logo.svg                                                                                                |
| `eurostat`                | Eurostat                           | https://ec.europa.eu/eurostat/o/estat-theme-ecl/images/header/estat-logo-horizontal.svg?browserId=chrome&minifierType=js&languageId=en_GB&t=1784569694000 |
| `fertagus`                | Fertagus                           | https://www.fertagus.pt/Resources/Shared/Fertagus/images/hlogo.png                                                                                        |
| `horarios-do-funchal`     | Horários do Funchal                | https://www.horariosdofunchal.pt/images/img/HF-logo.png                                                                                                   |
| `impic`                   | IMPIC                              | https://www.impic.pt/impic/assets/misc/img/logo-01.png                                                                                                    |
| `ioda`                    | IODA                               | https://ioda.inetintel.cc.gatech.edu/apple-touch-icon.png                                                                                                 |
| `ipma`                    | IPMA                               | https://www.ipma.pt/opencms/system/modules/ipma.website/resources/images/logo-ipma-17.svg                                                                 |
| `metro-do-porto`          | Metro do Porto                     | https://www.metrodoporto.pt/metrodoporto/layout/metroportologo.svg                                                                                        |
| `metropolitano-de-lisboa` | Metropolitano de Lisboa            | https://www.metrolisboa.pt/wp-content/uploads/2017/12/logo_ml.png                                                                                         |
| `nasa-firms`              | NASA FIRMS                         | https://firms.modaps.eosdis.nasa.gov/images/touch/icon-192x192.png                                                                                        |
| `nasa-power`              | NASA POWER                         | https://power.larc.nasa.gov/api/website/header/nasa-logo.svg                                                                                              |
| `omie`                    | OMIE                               | https://www.omie.es/sites/default/files/styles/logo/public/logo.png?itok=qTIjh2O6                                                                         |
| `peeringdb`               | PeeringDB                          | https://www.peeringdb.com/s/2.82.0/pdb-logo-coloured.png                                                                                                  |
| `ren`                     | REN                                | https://www.ren.pt/media/yoictzhh/logo.svg                                                                                                                |
| `ripe-ncc`                | RIPE NCC                           | https://www.ripe.net/static/images/ripe-community-logo.svg                                                                                                |
| `stcp`                    | STCP                               | https://www.stcp.pt/uploads/logo.svg                                                                                                                      |
| `tcb`                     | Transportes Colectivos do Barreiro | https://tcbarreiro.pt/wp-content/themes/JointsWP/assets/images/favicon/favicon.svg                                                                        |
