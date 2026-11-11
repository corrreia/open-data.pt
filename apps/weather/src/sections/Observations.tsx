import { Button, Table, Tabs } from "@cloudflare/kumo";
import { useRef, useState } from "react";
import { readStationDay, readStations, type StationReading } from "../api.ts";
import { Chart } from "../Chart.tsx";
import { COMPASS, format } from "../format.ts";
import { known, regionOf } from "../regions.ts";
import { colourOn, css, HUMIDITY, PRESSURE, RADIATION, RAIN, type Scale, strip, TEMPERATURE, WIND } from "../scales.ts";
import { useMapLayer } from "../stage.tsx";
import { Heights, project } from "../terrain/geometry.ts";
import { Failed, From, Heading, Nothing, Pending, Subheading, useRead } from "../ui.tsx";

/** What IPMA's stations measured in the last hour: one measure at a time, on the map and ranked, with each station's last day. */

interface Measure {
  /** The measure's name in the series keys of `ipma-observations`. */
  key: string;
  name: string;
  unit: string;
  scale: Scale;
  /** A sum over the hour is drawn as bars; a state at the hour as a line. */
  summed: boolean;
  of(station: StationReading): number | null;
}

const MEASURES: Measure[] = [
  { key: "temperature", name: "Temperatura", unit: "°C", scale: TEMPERATURE, summed: false, of: (station) => station.temperature },
  { key: "precipitation", name: "Chuva", unit: "mm", scale: RAIN, summed: true, of: (station) => station.precipitation },
  { key: "wind-speed", name: "Vento", unit: "km/h", scale: WIND, summed: false, of: (station) => station.windSpeed },
  { key: "humidity", name: "Humidade", unit: "%", scale: HUMIDITY, summed: false, of: (station) => station.humidity },
  { key: "pressure", name: "Pressão", unit: "hPa", scale: PRESSURE, summed: false, of: (station) => station.pressure },
  { key: "radiation", name: "Radiação solar", unit: "kJ/m²", scale: RADIATION, summed: true, of: (station) => station.radiation },
];

/** A station that has said nothing for this long is not telling us about now. */
const FRESH_MS = 3 * 3_600_000;

/** A measure's scale as a strip, with the value at every step of it. */
function Key(props: { measure: Measure }) {
  const { scale, unit, name } = props.measure;
  return (
    <div className="grid max-w-md gap-1">
      <p>{name} na última hora. Entre estações a cor é interpolada pela distância: não conhece a altitude nem o mar.</p>
      <span aria-hidden="true" className="block h-2.5 rounded-sm border border-black/20" style={{ background: strip(scale) }} />
      <span className="flex justify-between text-xs text-kumo-default tabular-nums">
        {scale.map(([value], index) => (
          <span key={value}>{index === scale.length - 1 ? `${value} ${unit}` : value}</span>
        ))}
      </span>
    </div>
  );
}

/** One station's last day of one measure. */
function StationDay(props: { station: StationReading; measure: Measure }) {
  const { station, measure } = props;
  const day = useRead(() => readStationDay(station.stationId, measure.key));
  return (
    <section aria-label={station.stationName} className="grid gap-2 rounded-lg border border-kumo-line bg-kumo-elevated p-4">
      <Subheading>{station.stationName}</Subheading>
      <p className="text-sm text-kumo-subtle">
        {measure.name} nas últimas 24 horas, em {measure.unit}. Última leitura às {format.hour(station.observationTime)}.
      </p>
      {day.state === "loading" ? <Pending what="o último dia" /> : null}
      {day.state === "failed" ? <Failed what="o último dia desta estação" message={day.message} retry={day.retry} /> : null}
      {day.state === "ready" && day.data.length < 2 ? <Nothing>Esta estação não tem leituras suficientes para um gráfico.</Nothing> : null}
      {day.state === "ready" && day.data.length >= 2 ? <Chart points={day.data} bars={measure.summed} unit={measure.unit} name={measure.name} time={format.hour} /> : null}
    </section>
  );
}

export function Observations() {
  const read = useRead(readStations);
  const [key, setKey] = useState("temperature");
  const [opened, setOpened] = useState<string>();
  const detail = useRef<HTMLDivElement>(null);
  const measure = MEASURES.find((each) => each.key === key) ?? MEASURES[0];
  const now = Date.now();
  const stations = read.state === "ready" ? read.data.filter((station) => now - Date.parse(station.observationTime) < FRESH_MS) : [];
  const readings =
    measure === undefined
      ? []
      : stations.flatMap((station) => (known(measure.of(station)) ? [{ station, value: measure.of(station) ?? 0 }] : [])).toSorted((a, b) => b.value - a.value);
  const station = stations.find((each) => each.stationId === opened);

  const open = (stationId: string): void => {
    setOpened(stationId);
    // The day opens above the table: bring it into view, at once for whoever asked for less motion.
    requestAnimationFrame(() => detail.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
  };

  useMapLayer(() => {
    if (measure === undefined) return { marks: [], legend: null };
    // The land takes the measure's colour between the mainland's stations.
    const field = new Heights(40);
    for (const { station: each, value } of readings) if (regionOf(each.longitude) === "Continente") field.add(project([each.longitude, each.latitude]), value);
    return {
      legend: <Key measure={measure} />,
      paint: readings.length === 0 ? undefined : (point, into) => void into.setHex(colourOn(measure.scale, field.at(point, 6, 12))),
      marks: readings.map(({ station: each, value }) => {
        const wind = measure.key === "wind-speed" ? COMPASS.get(each.windDirection ?? "") : undefined;
        return {
          id: each.stationId,
          longitude: each.longitude,
          latitude: each.latitude,
          detail: `${each.stationName}: ${format.measure(value, measure.unit)}${wind === undefined ? "" : `, de ${wind.name}`}, às ${format.hour(each.observationTime)}`,
          onSelect: () => open(each.stationId),
          node: (
            <span className="flex items-center gap-0.5 rounded-sm border border-kumo-line bg-kumo-base px-1 text-xs leading-5 text-kumo-strong tabular-nums">
              {wind === undefined ? null : <From point={each.windDirection} className="size-3" />}
              {format.number(value)}
            </span>
          ),
        };
      }),
    };
  }, [read.state, key]);

  if (measure === undefined) return null;
  return (
    <>
      <Heading title="Observações">O que as estações do IPMA mediram na última hora. Escolha uma estação, na tabela ou no mapa, para ver o seu último dia.</Heading>
      {read.state === "loading" ? <Pending what="as estações" /> : null}
      {read.state === "failed" ? <Failed what="as estações" message={read.message} retry={read.retry} /> : null}
      {read.state !== "ready" ? null : (
        <>
          <div className="scroll-fade overflow-x-auto">
            <Tabs
              variant="segmented"
              value={key}
              onValueChange={(value) => {
                setKey(String(value));
                setOpened(undefined);
              }}
              tabs={MEASURES.map((each) => ({ value: each.key, label: each.name }))}
            />
          </div>
          <div ref={detail} className="scroll-mt-4">
            {station === undefined ? null : <StationDay key={`${station.stationId}:${measure.key}`} station={station} measure={measure} />}
          </div>
          {readings.length === 0 ? (
            <Nothing>Nenhuma estação comunicou {measure.name.toLowerCase()} nas últimas três horas.</Nothing>
          ) : (
            <div className="overflow-x-auto">
              <Table aria-label={`${measure.name} por estação, da mais alta para a mais baixa`}>
                <Table.Header>
                  <Table.Row>
                    <Table.Head>Estação</Table.Head>
                    <Table.Head className="text-end">{measure.name}</Table.Head>
                    <Table.Head className="text-end">Hora</Table.Head>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {readings.map(({ station: each, value }) => (
                    <Table.Row key={each.stationId}>
                      <Table.Cell>
                        <span className="flex items-center gap-2">
                          <span aria-hidden="true" className="size-3 shrink-0 rounded-sm border border-black/25" style={{ background: css(colourOn(measure.scale, value)) }} />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="-ml-2 text-start font-semibold"
                            aria-expanded={opened === each.stationId}
                            onClick={() => open(each.stationId)}
                          >
                            {each.stationName}
                          </Button>
                        </span>
                      </Table.Cell>
                      <Table.Cell className="text-end whitespace-nowrap tabular-nums">{format.measure(value, measure.unit)}</Table.Cell>
                      <Table.Cell className="text-end whitespace-nowrap text-kumo-subtle tabular-nums">{format.hour(each.observationTime)}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </div>
          )}
        </>
      )}
    </>
  );
}
