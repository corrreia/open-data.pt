import { Table, Tabs } from "@cloudflare/kumo";
import { useState } from "react";
import { readFireRisk, readMunicipalities, readUv } from "../api.ts";
import { format } from "../format.ts";
import { regionOf } from "../regions.ts";
import { css, FIRE_COLOURS, uvColour, uvInk, uvName } from "../scales.ts";
import { useMapLayer, useStage } from "../stage.tsx";
import { Failed, Heading, Level, Nothing, Pending, Subheading, useRead } from "../ui.tsx";
import { datesFrom, Days } from "./Days.tsx";

/** Two daily indices IPMA forecasts: the sun's ultraviolet radiation, and the danger of rural fire in each municipality. */

function Uv() {
  const { today } = useStage();
  const read = useRead(readUv);
  const forecasts = read.state === "ready" ? read.data : [];
  const dates = datesFrom(
    forecasts.map((each) => each.date),
    today,
  );
  const [chosen, setChosen] = useState<string>();
  const date = chosen !== undefined && dates.includes(chosen) ? chosen : dates[0];
  const day = forecasts.filter((each) => each.date === date).toSorted((a, b) => b.uvIndex - a.uvIndex);

  useMapLayer(
    () => ({
      legend: (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Índice ultravioleta máximo previsto:</span>
          {[1, 4, 7, 9, 11].map((index) => (
            <Level key={index} colour={uvColour(index)}>
              {uvName(index)}
            </Level>
          ))}
        </p>
      ),
      marks: day.map((each) => ({
        id: each.locationId,
        longitude: each.longitude,
        latitude: each.latitude,
        detail: `${each.location}: índice ultravioleta ${format.number(each.uvIndex)}, ${uvName(each.uvIndex)}`,
        node: (
          <span
            className="grid h-7 min-w-7 place-items-center rounded-full border border-black/40 px-1.5 text-sm font-bold tabular-nums"
            style={{ background: css(uvColour(each.uvIndex)), color: uvInk(each.uvIndex) }}
          >
            {Math.round(each.uvIndex)}
          </span>
        ),
      })),
    }),
    [read.state, date],
  );

  if (read.state === "loading") return <Pending what="o índice ultravioleta" />;
  if (read.state === "failed") return <Failed what="o índice ultravioleta" message={read.message} retry={read.retry} />;
  if (date === undefined) return <Nothing>O IPMA não tem previsão do índice ultravioleta de hoje em diante.</Nothing>;
  return (
    <>
      <Days dates={dates} today={today} value={date} onChange={setChosen} />
      <div className="overflow-x-auto">
        <Table aria-label="Índice ultravioleta por local, do mais alto para o mais baixo">
          <Table.Header>
            <Table.Row>
              <Table.Head>Local</Table.Head>
              <Table.Head className="text-end">Índice</Table.Head>
              <Table.Head>Nível</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {day.map((each) => (
              <Table.Row key={each.locationId}>
                <Table.Cell className="font-semibold text-kumo-strong">{each.location}</Table.Cell>
                <Table.Cell className="text-end tabular-nums">{format.number(each.uvIndex)}</Table.Cell>
                <Table.Cell>
                  <Level colour={uvColour(each.uvIndex)}>{uvName(each.uvIndex)}</Level>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </>
  );
}

async function readFire() {
  const [risks, municipalities] = await Promise.all([readFireRisk(), readMunicipalities()]);
  return { risks, names: new Map(municipalities.map((each) => [each.dtmn, each.municipio])) };
}

function Fire() {
  const { today } = useStage();
  const result = useRead(readFire);
  const risks = result.state === "ready" ? result.data.risks.filter((each) => regionOf(each.longitude) === "Continente") : [];
  const name = (code: string): string => (result.state === "ready" ? result.data.names.get(code) : undefined) ?? code;
  const dates = datesFrom(
    risks.map((each) => each.forecastDate),
    today,
  );
  const [chosen, setChosen] = useState<string>();
  const date = chosen !== undefined && dates.includes(chosen) ? chosen : dates[0];
  const day = risks.filter((each) => each.forecastDate === date);
  const levels = [...new Set(day.map((each) => each.riskLevel))].toSorted((a, b) => b - a);
  const label = (level: number): string => day.find((each) => each.riskLevel === level)?.riskLabel ?? `${level}`;

  useMapLayer(
    () => ({
      legend: (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Perigo de incêndio rural previsto por concelho:</span>
          {levels.toReversed().map((level) => (
            <Level key={level} colour={FIRE_COLOURS[level] ?? 0x999999}>
              {label(level)}
            </Level>
          ))}
        </p>
      ),
      marks: day.map((each) => ({
        id: each.municipalityCode,
        longitude: each.longitude,
        latitude: each.latitude,
        detail: `${name(each.municipalityCode)}: perigo de incêndio ${each.riskLabel.toLowerCase()}`,
        node: <span className="block size-3 rounded-full border border-black/50" style={{ background: css(FIRE_COLOURS[each.riskLevel] ?? 0x999999) }} />,
      })),
    }),
    [result.state, date],
  );

  if (result.state === "loading") return <Pending what="o perigo de incêndio" />;
  if (result.state === "failed") return <Failed what="o perigo de incêndio" message={result.message} retry={result.retry} />;
  if (date === undefined) return <Nothing>O IPMA não tem previsão do perigo de incêndio de hoje em diante.</Nothing>;
  return (
    <>
      <Days dates={dates} today={today} value={date} onChange={setChosen} />
      {levels.map((level) => {
        const here = day.filter((each) => each.riskLevel === level);
        return (
          <section key={level} className="grid gap-1.5">
            <Subheading>
              <Level colour={FIRE_COLOURS[level] ?? 0x999999}>
                {label(level)}, {here.length} {here.length === 1 ? "concelho" : "concelhos"}
              </Level>
            </Subheading>
            <p className="text-sm text-kumo-subtle">
              {here
                .map((each) => name(each.municipalityCode))
                .toSorted((a, b) => a.localeCompare(b, "pt"))
                .join(", ")}
            </p>
          </section>
        );
      })}
    </>
  );
}

export function Indices() {
  const [index, setIndex] = useState("uv");
  return (
    <>
      <Heading title="UV e incêndio">Duas previsões diárias do IPMA: a radiação ultravioleta do sol e o perigo de incêndio rural.</Heading>
      <Tabs
        variant="underline"
        value={index}
        onValueChange={(value) => setIndex(String(value))}
        tabs={[
          { value: "uv", label: "Ultravioleta" },
          { value: "fire", label: "Perigo de incêndio" },
        ]}
      />
      {index === "uv" ? <Uv /> : <Fire />}
    </>
  );
}
