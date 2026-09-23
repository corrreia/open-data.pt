# APA · Agência Portuguesa do Ambiente

Portugal's environment agency. We read its water data (river levels and flows, reservoirs, weather
stations, groundwater, flood alerts, drought), and its reference layers.

## Source

APA is read through three libraries, and they are split so that no value is published twice:

| Library    | Where                                                     | What                                                                                         |
| ---------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `arcgis`   | `sniambgeoogc.apambiente.pt` (SNIAmb)                     | Reference layers: station locations, beaches and their current water quality, flood marks    |
| `snirh`    | `snirh.apambiente.pt` (SNIRH, the water resources system) | Every measurement, with its history: the station database and three monthly bulletins        |
| `infoagua` | `infoagua.apambiente.pt` (InfoÁgua, the public water app) | What only InfoÁgua publishes: each watched station's flood alert, each basin's drought index |

InfoÁgua shows the same readings as SNIRH, sooner. They are not read from it: it keeps only 48
hours, so a feed built on it could never be backfilled, and the two sources would overlap. Its beach
pages repeat the ArcGIS `Praias` layer, so those are not read either. Its flood alerts and drought
index have no archive at all, so their history starts from our first collection.

## Access

No credentials. SNIRH has no API: the `snirh` library reads what its own pages read.

- **Station lists need a session.** The station database keeps its filter in a PHP session. The
  library posts the form (network, parameter, `f_estado=ATIVA` live, empty for history) to
  `/index.php?idMain=2&idItem=1`, then reads `xml_listaestacoes.php` with the `PHPSESSID` it got.
- **Readings come from the CSV export**, `paraCSV/dados_csv.php?sites=…&pars=…&tmin=dd/mm/yyyy&tmax=…`.
  Its own form allows 50 station–parameter pairs, and at about 500 stations the server times out at
  60 seconds, so requests go in batches of 50 stations.
- **The bulletins** are `coresXML.php` (monthly precipitation), `dadosxml.php` (groundwater state) and
  `tabelageral.php` (reservoir storage by basin). They are the data behind retired Flash pages, and
  still current.
- **Blocked by name, 22 September 2026.** Since about 12:30 UTC that day, SNIRH answers 403 to any
  request whose User-Agent contains `open-data.pt`, and to nothing else. It began about three hours
  into the first history walk, which sent tens of thousands of slow exports, several at once. SNIRH
  is now read at most once every five seconds (`minIntervalSeconds` in APA's `index.ts`).

## Quirks

- **Columns carry no station.** The export's header names the parameter above each column, never the
  station. Columns follow the order of `sites`, but a station that does not hold the parameter gets
  no column at all. When the column count is not the site count, the library halves the batch until
  it lines up, and checks every column's label against the parameter asked for.
- **Wells are listed differently.** River and weather stations appear as `estacao="■ NAME (CODE)"`;
  wells as `■ CODE` alone. The code is always in the `html` tooltip, with its entities encoded twice.
- **Clock.** Times are a fixed UTC clock: the spring clock-change day still has 24 hourly readings,
  and InfoÁgua's times match SNIRH's to the hour.
- **Encodings.** The pages and the CSV are Windows-1252; the station list and the bulletin XML are UTF-8.
- **Lag.** Telemetry reaches the database a few hours to a day late, and more slowly at night. One
  batch of 50 stations takes 1 to 15 seconds, so the weather network's eleven batches can take minutes.
- **"Active" is not "reporting".** Of about 500 active rain gauges, about 60 reported in September 2026.
- **Month numbers** in the precipitation bulletin must have two digits: `mestarget=8` answers with
  every value empty.
- The automatic water-quality network has reported nothing since 2024, and pressure has no station
  at all; neither is read.

## Permission

Not asked. SNIRH's footer states: "É permitido o uso dos conteúdos deste site, desde que mencionada a
sua fonte" (the site's contents may be used if the source is named), which is the `snirh-terms`
licence. InfoÁgua states no terms of its own (`source-terms`). APA's SNIAmb layers are CC BY 4.0 on
dados.gov.pt. There is no `robots.txt` on either site.
