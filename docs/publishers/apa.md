# APA · Agência Portuguesa do Ambiente

Portugal's environment agency. We read its water data (river levels and flows, reservoirs, weather
stations, groundwater, flood alerts, drought), and its reference layers.

## Source

APA is read through four libraries, and they are split so that no value is published twice:

| Library    | Where                                                     | What                                                                                                                                                                                                                                              |
| ---------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `arcgis`   | `sniambgeoogc.apambiente.pt` (SNIAmb)                     | Reference layers: station locations, beaches and their current water quality, flood marks, landfills, combustion plants, impact assessments, EMAS sites, waste infrastructure and operators; live beach occupancy; radioactivity readings (SIRAD) |
| `snirh`    | `snirh.apambiente.pt` (SNIRH, the water resources system) | Every measurement, with its history: the station database and three monthly bulletins                                                                                                                                                             |
| `infoagua` | `infoagua.apambiente.pt` (InfoÁgua, the public water app) | What only InfoÁgua publishes: each watched station's flood alert, each basin's drought index, each reservoir's capacity and uses, and the hourly flow into and out of each reservoir it watches                                                   |
| `qualar`   | `qualar.apambiente.pt` (QualAr, the air quality system)   | The latest hour of each pollutant at every station of the national air quality network                                                                                                                                                            |

InfoÁgua shows the last day or two of SNIRH's readings at the stations it watches for floods,
sooner than SNIRH does. Two SNIRH feeds take their **live** readings from it, because SNIRH itself now
answers only from Portugal (below): river levels (hourly, 48 hours, about 90 stations) and
precipitation (every 15 minutes, 24 hours, about 90 gauges). They stay SNIRH feeds: same slug, same
series keyed by SNIRH's station code, and their history walk still reads SNIRH's database. Nothing
else is read from InfoÁgua's readings that SNIRH also publishes, so no value is published twice.

What else InfoÁgua shows, and why each is or is not read (surveyed 29 September 2026):

- **Read:** the reservoirs of its drought pages (`/pt/seca/secas-pesquisa`, `DATA_SupStations`):
  capacity, usable volume and full supply level, uses, and each calendar month's lowest volume on
  record; and the hourly inflow and outflow on each watched reservoir's page, which we read from
  nowhere else. Reservoir levels stay on SNIRH: InfoÁgua watches about 46 of the 84 reservoirs our
  SNIRH feed carries, so moving it would stop the others.
- **Not read:** each reservoir's monthly volume (`/pt/seca/seca-detalhe/<site>`), which repeats
  SNIRH's reservoir storage; the beach pages, which repeat the ArcGIS `Praias` layer but for the date
  of the last sample; the summary charts (top rainfall, alert counts), which are derived; river flow
  on the river stations' pages, empty where we looked and not SNIRH's daily mean.
- **Worth reading next:** each station's flood alert thresholds (`DATA_AlertsHistory` on its page,
  the water level for each alert level with a note such as a return period), and each basin's
  monthly mean and historic monthly minimum storage (`DATA_VolumesMap` on `/pt/seca`).

Its flood alerts, drought index and reservoir flows have no archive, so their history starts from
our first collection.

## Access

No credentials. SNIRH has no API: the `snirh` library reads what its own pages read.

- **Station lists need a session.** The station database keeps its filter in a PHP session. The
  library posts the form (network, parameter, and an empty `f_estado`: every station, since one SNIRH
  lists as inactive can still report) to
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
  is now read at most once every five seconds (`minIntervalSeconds` in APA's `index.ts`), and under a
  common Chrome User-Agent (`userAgent` there) rather than ours. The history walk still runs, at that
  pace.
- **Only from Portugal, since 27 September 2026.** SNIRH answers 403 to requests from every
  Cloudflare location but Lisbon (in a day of sampled requests on 28 September: Lisbon 6 answered;
  Madrid 15, Marseille 3, Milan 2 and Paris 1 refused), and from outside Portugal generally; from a
  Portuguese connection it answers. A feed's collections mostly leave from the same location, so some
  SNIRH feeds read and others never do. Three placement hints were tried and removed: `hostname`
  (Cloudflare's HTTP probes are refused too, and it placed SNIRH near Paris), `region` Madrid (Madrid
  is refused), and `host` over TCP (it placed nothing). No cloud region is in Portugal, and placement
  cannot name a Cloudflare location. A tunnel through a Portuguese home connection worked until APA
  dropped that address at its firewall, on 29 September, within minutes. River levels and
  precipitation now read live from InfoÁgua instead; the other SNIRH feeds read when a collection
  happens to leave from Lisbon.

## Quirks

- **Radioactivity (SIRAD).** `Visualizador/sirad` holds one layer per measurement (1 gamma dose rate
  in air, 2 in river water, 5 gamma activity of aerosols; 3, 4 and 6, alpha, beta and iodine, stopped
  in July 2026 and are not read), each with only the latest reading of every station. The feeds read
  them every hour through the `arcgis` library and `radioactivity.ts` turns the rows into one series
  per station, so the history is ours. `data_hora` is an ArcGIS date: ArcGIS keeps dates in UTC and
  the layer declares no other time zone; the newest reading was 30 to 45 minutes old against UTC when
  read. Not compared with another source.
- **Layers left out, 30 September 2026:** the pollutant release register (`SNIAmb/Licenciamento`),
  which carries each establishment's email, phone and fax, some of them a named person's, and which
  the `arcgis` library cannot publish without; marine litter (`Visualizador/LixoMarinho`), which
  refuses queries; noise maps, flood-risk zones and impact-assessment areas, which are large polygons
  that change every few years; and `Visualizador/SolarFlutuantes`, whose layers are water-supply
  intakes, not floating solar.
- **QualAr's air quality.** The app reads `/api/app.php?type=…`; the library reads `type=medicoes&data=YYYY-MM-DD`,
  which answers, for that day, every station with the latest hour of each pollutant (`avg`, `validado`, `hora`,
  `indice`), in the order of the day's `colunas`, and `N.D.` for an hour without a value. A live collection reads
  yesterday and today, so the hours that close a day are not missed. `type=dados` has a station's 24 hours of a day
  (a history walk could use it, at 72 requests a day); `download.php` serves only validated data, a year after. Hours
  are UTC: QualAr does not say so, but nitrogen dioxide at the Lisbon traffic stations peaks at hour 7 and again at
  17 to 18 on a working day, the rush hours in Lisbon time in summer, and EU air quality reporting uses local
  standard time, which in mainland Portugal is UTC. Whether an hour is labelled by its start or its end is not
  stated; readings are dated by the start of the hour. QualAr is on the same server as SNIRH (193.136.235.19),
  which refuses most of Cloudflare's locations; whether it refuses QualAr too was not known when the feed was added.

- **InfoÁgua's readings.** A station's page is `/pt/cheias/cheia-detalhe/<SNIRH site>`, with
  `DATA_StationParameters`: InfoÁgua's own parameter identifiers (4 river level, 5 rain in 15 minutes,
  6 reservoir inflow, 2 reservoir outflow)
  and names, which the library checks. Times are UTC, as SNIRH's: at five river stations whose level
  changed during those hours, every value matched at the same hour and none an hour either side. InfoÁgua names a station only by
  its SNIRH site; `snirh/stations.ts` pairs each site with the code and name SNIRH's station lists
  print, read from those lists on 27 September 2026. A station missing there (one SNIRH added since,
  or one in Spain, such as Badajoz and Riviera Gata) is rejected. Checked against SNIRH's database on
  29 September, 15 river stations over 36 hours: 13 identical; Atrozela (21A/06H) shows 0 where SNIRH
  has a level below the gauge zero, and Junção das Ribeiras (21A/02H) about 0.05 m where SNIRH has
  0.10 m. An hour of rain is the sum of the four quarters ending in it; that quarters end at their
  time (11:00 is 10:45 to 11:00) is InfoÁgua's convention as its pages show it, not yet compared
  with SNIRH's hourly totals.

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
dados.gov.pt. The layers added on 30 September 2026 (the `Visualizador` and `AIA` services, and the
SNIAmb landfill, EMAS and waste layers) are listed there with their licence not specified, so they
carry `source-terms`. There is no `robots.txt` on either site.
