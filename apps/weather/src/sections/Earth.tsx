import { Table, Tabs } from "@cloudflare/kumo";
import { useState } from "react";
import { readDischarges, readEarthquakes, readLightningHours } from "../api.ts";
import { Chart } from "../Chart.tsx";
import { format } from "../format.ts";
import { known, regionOf } from "../regions.ts";
import { useMapLayer } from "../stage.tsx";
import { Failed, Heading, Nothing, Pending, Subheading, useRead } from "../ui.tsx";

/** What IPMA's networks detected: the earthquakes of the last thirty days and the lightning of the last day. */

const DAY_MS = 86_400_000;

function Quakes() {
  const read = useRead(readEarthquakes);
  const quakes = read.state === "ready" ? read.data.toSorted((a, b) => b.time.localeCompare(a.time)) : [];

  useMapLayer(
    () => ({
      legend: <p>Sismos dos últimos trinta dias. O círculo cresce com a magnitude.</p>,
      marks: quakes.flatMap((quake) => {
        if (!known(quake.magnitude)) return [];
        const size = 6 + quake.magnitude * 5;
        return [
          {
            id: quake.id,
            longitude: quake.longitude,
            latitude: quake.latitude,
            detail: `Sismo de magnitude ${format.number(quake.magnitude)}, ${quake.region ?? regionOf(quake.longitude)}, ${format.when(quake.time)}`,
            node: <span className="block rounded-full border-2 border-kumo-danger bg-kumo-danger/20" style={{ width: size, height: size }} />,
          },
        ];
      }),
    }),
    [read.state],
  );

  if (read.state === "loading") return <Pending what="os sismos" />;
  if (read.state === "failed") return <Failed what="os sismos" message={read.message} retry={read.retry} />;
  if (quakes.length === 0) return <Nothing>O IPMA não registou sismos nos últimos trinta dias.</Nothing>;
  return (
    <>
      <p className="max-w-[60ch] text-sm text-kumo-subtle">
        {quakes.length} sismos registados pelo IPMA nos últimos trinta dias, no continente e nas ilhas, do mais recente para o mais antigo.
      </p>
      <div className="overflow-x-auto">
        <Table aria-label="Sismos dos últimos trinta dias">
          <Table.Header>
            <Table.Row>
              <Table.Head className="text-end">Magnitude</Table.Head>
              <Table.Head>Onde</Table.Head>
              <Table.Head className="text-end">Profundidade</Table.Head>
              <Table.Head className="text-end">Quando</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {quakes.map((quake) => (
              <Table.Row key={quake.id}>
                <Table.Cell className="text-end font-semibold text-kumo-strong tabular-nums">{known(quake.magnitude) ? format.number(quake.magnitude) : "–"}</Table.Cell>
                <Table.Cell>{quake.region ?? regionOf(quake.longitude)}</Table.Cell>
                <Table.Cell className="text-end whitespace-nowrap text-kumo-subtle tabular-nums">{format.measure(quake.depth, "km")}</Table.Cell>
                <Table.Cell className="text-end whitespace-nowrap text-kumo-subtle tabular-nums">{format.when(quake.time)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </>
  );
}

async function readLightning() {
  const [discharges, hours] = await Promise.all([readDischarges(), readLightningHours()]);
  return { discharges, hours };
}

function Lightning() {
  const result = useRead(readLightning);
  const now = Date.now();
  const recent = result.state === "ready" ? result.data.discharges.filter((each) => now - Date.parse(each.occurredAt) < DAY_MS) : [];
  // Cloud-to-ground strikes over the mainland, hour by hour, for the last two days.
  const mainland =
    result.state === "ready"
      ? result.data.hours
          .filter((point) => point.seriesKey === "mainland:cloud-to-ground" && now - Date.parse(point.eventTime) < 2 * DAY_MS)
          .toSorted((a, b) => a.eventTime.localeCompare(b.eventTime))
      : [];

  useMapLayer(
    () => ({
      legend: <p>Descargas elétricas das últimas 24 horas. As mais recentes são as mais carregadas.</p>,
      marks: recent.map((each, index) => ({
        id: `${each.occurredAt}:${index}`,
        longitude: each.longitude,
        latitude: each.latitude,
        detail: `Descarga ${each.type === "in-cloud" ? "dentro da nuvem" : "nuvem-solo"}, ${format.when(each.occurredAt)}`,
        node: <span className="block size-2.5 rotate-45 border border-white bg-violet-700" style={{ opacity: 1 - ((now - Date.parse(each.occurredAt)) / DAY_MS) * 0.7 }} />,
      })),
    }),
    [result.state],
  );

  if (result.state === "loading") return <Pending what="a trovoada" />;
  if (result.state === "failed") return <Failed what="a trovoada" message={result.message} retry={result.retry} />;
  return (
    <>
      {recent.length === 0 ? (
        <Nothing>A rede do IPMA não localizou descargas elétricas nas últimas 24 horas.</Nothing>
      ) : (
        <p className="max-w-[60ch] text-sm text-kumo-subtle">{recent.length} descargas elétricas localizadas pela rede do IPMA nas últimas 24 horas.</p>
      )}
      {mainland.length < 2 ? null : (
        <section className="grid gap-2">
          <Subheading>Descargas nuvem-solo por hora, no continente</Subheading>
          <Chart points={mainland} bars unit="descargas" name="Descargas nuvem-solo por hora" time={format.when} />
        </section>
      )}
    </>
  );
}

export function Earth() {
  const [network, setNetwork] = useState("quakes");
  return (
    <>
      <Heading title="Sismos e trovoada">O que as redes do IPMA detetaram: sismos e descargas elétricas.</Heading>
      <Tabs
        variant="underline"
        value={network}
        onValueChange={(value) => setNetwork(String(value))}
        tabs={[
          { value: "quakes", label: "Sismos" },
          { value: "lightning", label: "Trovoada" },
        ]}
      />
      {network === "quakes" ? <Quakes /> : <Lightning />}
    </>
  );
}
