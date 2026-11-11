import { Table } from "@cloudflare/kumo";
import { useState } from "react";
import { readSea, readShellfish, type SeaForecast, type ShellfishZone } from "../api.ts";
import { COMPASS, format } from "../format.ts";
import { known, regionOf, REGIONS } from "../regions.ts";
import { useMapLayer, useStage } from "../stage.tsx";
import { Failed, From, Heading, Nothing, Pending, Subheading, useRead } from "../ui.tsx";
import { datesFrom, Days } from "./Days.tsx";

/** The state of the sea along the coast for three days, and where shellfish may be gathered. */

/** IPMA's three states of a zone, in words and in the tone each is written in. */
const STATUS = new Map([
  ["OPEN", { name: "Aberta", tone: "text-kumo-success" }],
  ["PARTIAL_OPEN", { name: "Aberta em parte", tone: "text-kumo-warning" }],
  ["CLOSE", { name: "Fechada", tone: "text-kumo-danger" }],
]);

const coast = (sea: SeaForecast): string => sea.location.replace(/, costa$/iu, "");

function Coasts(props: { region: string; forecasts: readonly SeaForecast[] }) {
  return (
    <section className="grid gap-2">
      <Subheading>{props.region}</Subheading>
      <div className="overflow-x-auto">
        <Table aria-label={`Estado do mar: ${props.region}`}>
          <Table.Header>
            <Table.Row>
              <Table.Head>Costa</Table.Head>
              <Table.Head>Ondulação</Table.Head>
              <Table.Head className="text-end">Período</Table.Head>
              <Table.Head className="text-end">Água</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {props.forecasts.map((sea) => (
              <Table.Row key={sea.locationId}>
                <Table.Cell className="font-semibold text-kumo-strong">{coast(sea)}</Table.Cell>
                <Table.Cell className="whitespace-nowrap tabular-nums">
                  <From point={sea.waveDirection} className="mr-1.5" />
                  {format.range(sea.waveHeightMin, sea.waveHeightMax, "m")}
                </Table.Cell>
                <Table.Cell className="text-end whitespace-nowrap tabular-nums">{format.range(sea.wavePeriodMin, sea.wavePeriodMax, "s")}</Table.Cell>
                <Table.Cell className="text-end whitespace-nowrap tabular-nums">{format.range(sea.seaSurfaceTemperatureMin, sea.seaSurfaceTemperatureMax, "°C")}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </section>
  );
}

function Zones(props: { zones: readonly ShellfishZone[] }) {
  return (
    <section className="grid gap-2">
      <Subheading>Apanha de bivalves</Subheading>
      <p className="max-w-[60ch] text-sm text-kumo-subtle">
        As zonas de produção de moluscos bivalves, de norte para sul, e as espécies cuja apanha o IPMA tem interdita em cada uma.
      </p>
      <div className="overflow-x-auto">
        <Table aria-label="Zonas de apanha de bivalves">
          <Table.Header>
            <Table.Row>
              <Table.Head>Zona</Table.Head>
              <Table.Head>Estado</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {props.zones.map((zone) => {
              const status = STATUS.get(zone.status);
              const closed = zone.closedSpecies.map((species) => species.specie_c).join(", ");
              return (
                <Table.Row key={zone.zoneCode}>
                  <Table.Cell>
                    <span className="font-semibold text-kumo-strong">{zone.name}</span>
                    {closed === "" ? null : <span className="block max-w-[46ch] text-xs text-kumo-subtle">Interdita: {closed}</span>}
                  </Table.Cell>
                  <Table.Cell className={`align-top text-sm font-medium whitespace-nowrap ${status?.tone ?? ""}`}>{status?.name ?? zone.status}</Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      </div>
    </section>
  );
}

async function read() {
  // The shellfish zones are a second thing on this page: without them the sea is still shown.
  const [sea, zones] = await Promise.all([readSea(), readShellfish().catch((): ShellfishZone[] => [])]);
  return { sea, zones: zones.toSorted((a, b) => (b.latitude ?? 0) - (a.latitude ?? 0)) };
}

export function Sea() {
  const { today } = useStage();
  const result = useRead(read);
  const sea = result.state === "ready" ? result.data.sea : [];
  const dates = datesFrom(
    sea.map((each) => each.forecastDate),
    today,
  );
  const [chosen, setChosen] = useState<string>();
  const date = chosen !== undefined && dates.includes(chosen) ? chosen : dates[0];
  const day = sea.filter((each) => each.forecastDate === date).toSorted((a, b) => b.latitude - a.latitude);

  useMapLayer(
    () => ({
      legend: <p>Altura máxima das ondas prevista em cada troço de costa, e de onde vêm.</p>,
      marks: day.map((each) => ({
        id: each.locationId,
        longitude: each.longitude,
        latitude: each.latitude,
        detail: `${coast(each)}: ondas de ${format.range(each.waveHeightMin, each.waveHeightMax, "m")}${COMPASS.has(each.waveDirection ?? "") ? `, de ${COMPASS.get(each.waveDirection ?? "")?.name}` : ""}, água a ${format.range(each.seaSurfaceTemperatureMin, each.seaSurfaceTemperatureMax, "°C")}`,
        node: (
          <span className="flex items-center gap-1 rounded-full border border-kumo-line bg-kumo-base px-2 py-0.5 text-sm text-kumo-strong tabular-nums shadow-xs">
            <From point={each.waveDirection} className="size-3.5 text-kumo-brand" />
            <b className="font-semibold">{known(each.waveHeightMax) ? format.measure(each.waveHeightMax, "m") : "–"}</b>
          </span>
        ),
      })),
    }),
    [result.state, date],
  );

  return (
    <>
      <Heading title="Mar">A previsão do IPMA para o estado do mar na costa: ondulação, período das ondas e temperatura da água.</Heading>
      {result.state === "loading" ? <Pending what="o estado do mar" /> : null}
      {result.state === "failed" ? <Failed what="o estado do mar" message={result.message} retry={result.retry} /> : null}
      {result.state === "ready" && date === undefined ? <Nothing>O IPMA ainda não publicou a previsão do mar para hoje. Costuma sair de manhã cedo.</Nothing> : null}
      {date === undefined ? null : (
        <>
          <Days dates={dates} today={today} value={date} onChange={setChosen} />
          {REGIONS.map((region) => {
            const here = day.filter((each) => regionOf(each.longitude) === region);
            return here.length === 0 ? null : <Coasts key={region} region={region} forecasts={here} />;
          })}
        </>
      )}
      {result.state === "ready" && result.data.zones.length > 0 ? <Zones zones={result.data.zones} /> : null}
    </>
  );
}
