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
their brand page — or was supplied by the project owner from one; never a logo
aggregator or a redrawing. Prefer SVG, then PNG at around twice the size it is drawn.
A mark must

- be **full colour or dark**: it is drawn on a white tile, so a white-on-transparent
  variant disappears and is not used;
- be **at most eight times as wide as it is tall**, and ideally nearer square: the tile
  keeps one height and widens only so far, and a long lockup set in small type becomes a
  smudge at 40px. Where the publisher only draws a long lockup, crop it to the part that
  names them — the seal, the symbol, the acronym — rather than shrink the whole thing;
- **fetch nothing**: no `href` or `url()` to another host inside an SVG;
- stay **under 48 KB**.

When a publisher has both a symbol and a wordmark, take the one that still reads at 18px.

A publisher who draws their mark only in white, for their own dark site, is the one case
where the file is altered rather than taken as it is: the ink is changed and nothing else, so
the shape stays theirs. Anything past re-inking would be a redrawing, and is not done here.
A publisher with no usable mark at all is drawn as their initials instead, so an empty
`logo` is a fine answer and never looks like a broken page.

## Where each one came from

| Key                       | Publisher                          | Source                                                                                                                                                    |
| ------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agif`                    | AGIF                               | https://www.agif.pt/app/themes/agif/dist/images/logo_agif_ef6b4e2d.svg, cropped to the symbol: their wordmark is drawn white and vanishes on the tile     |
| `anepc`                   | ANEPC                              | supplied by the project owner; the seal alone, trimmed and drawn smaller here                                                                             |
| `apa`                     | APA                                | https://apambiente.pt/themes/custom/apa_theme/images/logo-apa.png                                                                                         |
| `arquivo-pt`              | Arquivo.pt                         | supplied by the project owner; trimmed here                                                                                                               |
| `arte`                    | ARTE                               | https://www.arte.gov.pt/wp-content/uploads/2025/10/arte-logo.svg                                                                                          |
| `assembleia-da-republica` | Assembleia da República            | supplied by the project owner; trimmed and drawn smaller here                                                                                             |
| `banco-de-portugal`       | Banco de Portugal                  | https://www.bportugal.pt/themes/custom/bportugal/apple-touch-icon.png                                                                                     |
| `barraqueiro-oeste`       | Barraqueiro Oeste                  | https://www.barraqueiro-oeste.pt/img/logotipo.png                                                                                                         |
| `bird`                    | Bird                               | https://www.bird.co/favicon.svg                                                                                                                           |
| `boa-viagem`              | Boa Viagem                         | https://boa-viagem.pt/wp-content/uploads/2026/06/logo_completo.svg (the PNG inside that wrapper, drawn smaller)                                           |
| `bora`                    | Bora                               | https://www.cimvdl.pt/wp-content/uploads/2024/07/logo_bora_homepage_site.png (their only one; it carries a light grey plate)                              |
| `cada`                    | CADA                               | https://www.cada.pt/images/LogoCADA_90_31_t.png                                                                                                           |
| `carris-metropolitana`    | Carris Metropolitana               | https://www.carrismetropolitana.pt/assets/header/static/cmet-header-light.svg                                                                             |
| `cm-agueda`               | Câmara Municipal de Águeda         | https://www.cm-agueda.pt/cmagueda/uploads/site_zone/favicon/1/favs.png                                                                                    |
| `cm-cadaval`              | Município do Cadaval               | https://www.cm-cadaval.pt/favicon/favicon.svg                                                                                                             |
| `cm-cascais`              | Câmara Municipal de Cascais        | supplied by the project owner, white on a dark plate; the plate is dropped and the dots drawn dark instead, so the mark reads on a light page             |
| `cm-lisboa`               | Câmara Municipal de Lisboa         | https://www.lisboa.pt/_assets/fbd086277289c830376535e37e006784/Images/logo_vertical.svg                                                                   |
| `cm-mafra`                | Município de Mafra                 | https://www.cm-mafra.pt/cmmafra/layout/logo-mafra.svg, re-inked dark: Mafra draws it white for a dark site, and white vanishes on the tile                |
| `cm-oeiras`               | Câmara Municipal de Oeiras         | supplied by the project owner; cropped to the Oeiras Valley lockup, without the Município Oeiras half                                                     |
| `cm-porto`                | Câmara Municipal do Porto          | https://www.cm-porto.pt/images/logos/logoazul.svg                                                                                                         |
| `cp`                      | CP                                 | https://www.cp.pt/favicon.svg                                                                                                                             |
| `demarca-design`          | DEMARCA Design                     | https://www.designdemarca.pt/wp-content/uploads/DEMARCA-DESIGN-LOGO-s.png (drawn smaller)                                                                 |
| `dgeg`                    | DGEG                               | https://www.dgeg.gov.pt/Media/logo.png                                                                                                                    |
| `dglab`                   | DGLAB                              | supplied by the project owner; trimmed here                                                                                                               |
| `dgpj`                    | DGPJ                               | https://dgpj.justica.gov.pt/Portals/31/Logo%20DGPJ%20portugues.png (drawn smaller)                                                                        |
| `dgs`                     | DGS                                | https://www.dgs.pt/upload/DGSv9/imagens/i038120.png                                                                                                       |
| `dgt`                     | DGT                                | https://point.dgterritorio.gov.pt/images/logos/Logo_dgt.png                                                                                               |
| `e-redes`                 | E-REDES                            | https://www.e-redes.pt/themes/custom/eredes_theme/logo.svg                                                                                                |
| `effis-jrc`               | EFFIS                              | supplied by the project owner; cropped to the EFFIS mark, without the EU and Copernicus marks beside it                                                   |
| `eurostat`                | Eurostat                           | https://ec.europa.eu/eurostat/o/estat-theme-ecl/images/header/estat-logo-horizontal.svg?browserId=chrome&minifierType=js&languageId=en_GB&t=1784569694000 |
| `fertagus`                | Fertagus                           | https://www.fertagus.pt/Resources/Shared/Fertagus/images/hlogo.png                                                                                        |
| `horarios-do-funchal`     | Horários do Funchal                | https://www.horariosdofunchal.pt/images/img/HF-logo.png                                                                                                   |
| `impic`                   | IMPIC                              | https://www.impic.pt/impic/assets/misc/img/logo-01.png                                                                                                    |
| `ine`                     | INE                                | supplied by the project owner; trimmed here                                                                                                               |
| `ioda`                    | IODA                               | https://ioda.inetintel.cc.gatech.edu/apple-touch-icon.png                                                                                                 |
| `ipma`                    | IPMA                               | https://www.ipma.pt/opencms/system/modules/ipma.website/resources/images/logo-ipma-17.svg                                                                 |
| `lneg`                    | LNEG                               | https://www.lneg.pt/wp-content/themes/lneg/assets/img/logos/logo_lneg.png, re-inked dark for the same reason; every palette entry was white               |
| `mare`                    | Maré                               | https://myinfo.4cloud.pt/IP/MotorBusca/mare/Images/logos/MareH50.png (on white; maredematosinhos.pt is gone)                                              |
| `metro-do-porto`          | Metro do Porto                     | https://www.metrodoporto.pt/metrodoporto/layout/metroportologo.svg                                                                                        |
| `metropolitano-de-lisboa` | Metropolitano de Lisboa            | https://www.metrolisboa.pt/wp-content/uploads/2017/12/logo_ml.png                                                                                         |
| `nasa-firms`              | NASA FIRMS                         | https://firms.modaps.eosdis.nasa.gov/images/touch/icon-192x192.png                                                                                        |
| `nasa-power`              | NASA POWER                         | https://power.larc.nasa.gov/api/website/header/nasa-logo.svg                                                                                              |
| `omie`                    | OMIE                               | https://www.omie.es/sites/default/files/styles/logo/public/logo.png?itok=qTIjh2O6                                                                         |
| `peeringdb`               | PeeringDB                          | https://www.peeringdb.com/s/2.82.0/pdb-logo-coloured.png                                                                                                  |
| `ren`                     | REN                                | https://www.ren.pt/media/yoictzhh/logo.svg                                                                                                                |
| `ribatejana`              | Ribatejana                         | https://www.ribatejana.pt/img/logotipo.png                                                                                                                |
| `ripe-ncc`                | RIPE NCC                           | https://www.ripe.net/static/images/ripe-community-logo.svg                                                                                                |
| `sns-transparencia`       | SNS Transparência                  | supplied by the project owner; cropped to the mark and SNS, without Serviço Nacional de Saúde                                                             |
| `stcp`                    | STCP                               | https://www.stcp.pt/uploads/logo.svg                                                                                                                      |
| `tcb`                     | Transportes Colectivos do Barreiro | https://tcbarreiro.pt/wp-content/themes/JointsWP/assets/images/favicon/favicon.svg                                                                        |
| `tub-braga`               | TUB Braga                          | https://www.tub.pt/templates/frontoffice/_structure/img/logo_black.svg                                                                                    |
| `tubabike`                | TubaBike                           | https://www.tubabike.pt/wp-content/uploads/sites/67/2023/07/Favicon.svg                                                                                   |
| `usgs`                    | USGS                               | https://code.usgs.gov/uploads/-/system/appearance/logo/1/usgs-logo-black.svg                                                                              |
