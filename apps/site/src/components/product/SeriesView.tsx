import { Button, Chart, DatePicker, Empty, LayerCard, Loader, TimeseriesChart, type DateRange } from "@cloudflare/kumo";
import { CalendarBlankIcon, ChartLineIcon } from "@phosphor-icons/react";
import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useState } from "react";
import { DataTable, type Column } from "../DataTable";
import { ErrorNote, RelativeTime, useDarkMode } from "../common";
import { apiGet, productPath } from "../../lib/api";
import { echarts } from "../../lib/echarts";
import { SERIES_COLORS } from "../../lib/palette";
import { fmt } from "../../lib/format";
import { periodStart } from "../../lib/lisbon";
import { useQuery } from "../../lib/query";
import type { CursorPage, JsonRecord, Product, SeriesPoint, SeriesSummary, SummaryBucket, SummaryResolution } from "../../lib/types";
import { seriesLabel } from "./cells";
import { RowDialog } from "./RecordDialog";

const CHARTED = 10;
const BARS = 25;
const HOUR = 3_600_000;
const DAY = 86_400_000;

interface Series {
  key: string;
  label: string;
  unit: string;
  points: SeriesPoint[];
  latest: SeriesPoint | undefined;
}

interface Preset {
  id: string;
  label: string;
  ms: number;
}

const PRESETS: Preset[] = [
  { id: "7d", label: "7 days", ms: 7 * DAY },
  { id: "30d", label: "30 days", ms: 30 * DAY },
  { id: "1y", label: "1 year", ms: 365 * DAY },
  // By month, summaries reach back decades; the chart starts where the product's history does.
  { id: "all", label: "All", ms: 40 * 365 * DAY },
];

interface TimeWindow {
  from: string;
  to: string;
}

/** What the chart shows: the live window, a preset span back from now, or two chosen dates. */
type Span = { kind: "live" } | { kind: "preset"; preset: Preset } | { kind: "custom"; window: TimeWindow };

/** A span's window. Presets end at the next whole hour, so everyone asking within the hour shares one edge-cached answer. */
function windowOf(span: Span): TimeWindow | undefined {
  if (span.kind === "live") return undefined;
  if (span.kind === "custom") return span.window;
  const to = Math.ceil(Date.now() / HOUR) * HOUR;
  return { from: new Date(to - span.preset.ms).toISOString(), to: new Date(to).toISOString() };
}

const RESOLUTION_LABEL = { hour: "Hourly averages", day: "Daily averages, Lisbon days", month: "Monthly averages, Lisbon months" } satisfies {
  [resolution in SummaryResolution]: string;
};

const lisbonDate = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", day: "numeric", month: "short", year: "numeric" });
const lisbonMonth = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", month: "short", year: "numeric" });
const dayLabel = (value: string | number) => lisbonDate.format(new Date(value));

function periodLabel(start: string, resolution: SummaryResolution) {
  if (resolution === "hour") return fmt.dateTime(start);
  return resolution === "day" ? dayLabel(start) : lisbonMonth.format(new Date(start));
}

const escapeHtml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** One charted series: its summary buckets, with the live points past the last summarised day folded in. */
interface SummaryLine {
  key: string;
  label: string;
  buckets: SummaryBucket[];
  /** Whether live points reached it. */
  live: boolean;
}

function combine(a: SummaryBucket, b: SummaryBucket): SummaryBucket {
  const count = a.count + b.count;
  return { start: a.start, count, mean: (a.mean * a.count + b.mean * b.count) / count, min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) };
}

/** Summary buckets with live points added, each to the hour, Lisbon day or Lisbon month it falls in. */
function withLive(buckets: SummaryBucket[], points: SeriesPoint[], resolution: SummaryResolution): SummaryBucket[] {
  const merged = new Map(buckets.map((bucket) => [bucket.start, bucket]));
  for (const point of points) {
    if (point.value === null) continue;
    const start = periodStart(Date.parse(point.eventTime), resolution);
    const bucket = { start, count: 1, mean: point.value, min: point.value, max: point.value };
    const held = merged.get(start);
    merged.set(start, held ? combine(held, bucket) : bucket);
  }
  return [...merged.values()].sort((a, b) => a.start.localeCompare(b.start));
}

/** A chart row: time, mean, lowest, highest and how many points the bucket holds. */
type ChartRow = [time: number, mean: number, min: number, max: number, count: number];

/** A point as the dialog reads it: what the columns show, and the dimensions and clocks they leave out. */
export function pointRecord(point: SeriesPoint): JsonRecord {
  return {
    series: seriesLabel(point),
    seriesKey: point.seriesKey,
    eventTime: point.eventTime,
    value: point.value,
    unit: point.unit,
    dimensions: { ...point.dimensions },
    observedAt: point.observedAt,
  };
}

interface SummaryRow {
  key: string;
  label: string;
  start: string;
  count: number;
  mean: number;
  min: number;
  max: number;
}

function summaryOptions(lines: SummaryLine[], palette: readonly string[], unit: string, resolution: SummaryResolution): EChartsOption {
  const rows = lines.map((line) => line.buckets.map((bucket): ChartRow => [Date.parse(bucket.start), bucket.mean, bucket.min, bucket.max, bucket.count]));
  const suffix = unit ? ` ${unit}` : "";
  return {
    grid: { left: 8, right: 16, top: lines.length > 1 ? 36 : 16, bottom: 8, containLabel: true },
    legend: { show: lines.length > 1, type: "scroll", top: 0, data: lines.map((line) => line.label) },
    xAxis: { type: "time" },
    yAxis: { type: "value", scale: true, name: unit, axisLabel: { formatter: (value: number) => fmt.compact(value) } },
    tooltip: {
      trigger: "axis",
      // Each series shows its average and the range it moved in; the band's own two lines stay out of the list.
      formatter: (params) => {
        const list = (Array.isArray(params) ? params : [params]).filter((item) => (item.seriesIndex ?? 0) % 3 === 2);
        const first = list[0];
        const firstRow = first ? rows[Math.floor((first.seriesIndex ?? 0) / 3)]?.[first.dataIndex] : undefined;
        const heading = firstRow ? escapeHtml(periodLabel(new Date(firstRow[0]).toISOString(), resolution)) : "";
        const lines = list.map((item) => {
          const line = Math.floor((item.seriesIndex ?? 0) / 3);
          const row = rows[line]?.[item.dataIndex];
          if (!row) return "";
          const range = row[4] > 1 ? ` <span style="opacity:.7">(${fmt.cell(row[2], "number")}–${fmt.cell(row[3], "number")}, ${fmt.int(row[4])} points)</span>` : "";
          return `${item.marker ?? ""}${escapeHtml(item.seriesName ?? "")}: <b>${fmt.cell(row[1], "number")}${escapeHtml(suffix)}</b>${range}`;
        });
        return [heading, ...lines].filter(Boolean).join("<br/>");
      },
    },
    series: lines.flatMap((line, index) => {
      const color = palette[index % palette.length] ?? "#1b7a4f";
      const bucketRows = rows[index] ?? [];
      return [
        // The band: the lowest value, then the height up to the highest, stacked and shaded.
        {
          name: `${line.label} low`,
          type: "line",
          stack: `band-${index}`,
          data: bucketRows.map((row) => [row[0], row[2]]),
          symbol: "none",
          lineStyle: { opacity: 0 },
          silent: true,
        },
        {
          name: `${line.label} range`,
          type: "line",
          stack: `band-${index}`,
          data: bucketRows.map((row) => [row[0], row[3] - row[2]]),
          symbol: "none",
          lineStyle: { opacity: 0 },
          areaStyle: { color, opacity: 0.15 },
          silent: true,
        },
        // A lone bucket is drawn as a dot; a line needs two.
        { name: line.label, type: "line", data: bucketRows.map((row) => [row[0], row[1]]), color, showSymbol: bucketRows.length < 2, lineStyle: { width: 2 } },
      ];
    }),
  };
}

const pointKey = (point: SeriesPoint) => `${point.seriesKey}|${point.eventTime}`;

export default function SeriesView({ product, refreshKey, withHistory }: { product: Product; refreshKey: number; withHistory: boolean }) {
  const dark = useDarkMode();
  const current = useQuery(`series:${product.slug}`, () => apiGet<CursorPage<SeriesPoint>>(productPath(product.slug, "/series?limit=1000")).then((page) => page.data));
  const [span, setSpan] = useState<Span>({ kind: "live" });
  // Any row opens: a point's dimensions and clocks, or a bucket's exact numbers, are not in its columns.
  const [opened, setOpened] = useState<{ row: JsonRecord; title: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<DateRange | undefined>();
  const [pickedUnit, setPickedUnit] = useState<string | undefined>();
  const timeWindow = useMemo(() => windowOf(span), [span]);

  useEffect(() => {
    if (refreshKey > 0) void current.refetch();
  }, [refreshKey]);

  const points = current.data ?? [];
  const series = useMemo<Series[]>(() => {
    const groups = new Map<string, SeriesPoint[]>();
    for (const point of current.data ?? []) groups.set(point.seriesKey, [...(groups.get(point.seriesKey) ?? []), point]);
    return [...groups.entries()].map(([key, group]) => {
      const ordered = group.filter((point) => point.value !== null).sort((a, b) => a.eventTime.localeCompare(b.eventTime));
      const first = group[0];
      return { key, label: first ? seriesLabel(first) : key, unit: first?.unit ?? "", points: ordered, latest: ordered.at(-1) };
    });
  }, [current.data]);

  // Series in different units share no axis: the chart draws one unit at a time, the one most series use first.
  const units = useMemo(() => {
    const counts = new Map<string, number>();
    for (const each of series) counts.set(each.unit, (counts.get(each.unit) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([each]) => each);
  }, [series]);
  const mixed = units.length > 1;
  const unit = (pickedUnit !== undefined && units.includes(pickedUnit) ? pickedUnit : units[0]) ?? "";
  const shown = useMemo(() => (mixed ? series.filter((each) => each.unit === unit) : series), [series, mixed, unit]);
  const palette = dark ? SERIES_COLORS.dark : SERIES_COLORS.light;
  // A series with one or two points is a snapshot: compare the latest values instead of drawing flat lines.
  const snapshot = shown.length > 0 && shown.every((each) => each.points.length <= 2);
  const charted = useMemo(
    () => [...shown].sort((a, b) => b.points.length - a.points.length || Math.abs(b.latest?.value ?? 0) - Math.abs(a.latest?.value ?? 0)).slice(0, CHARTED),
    [shown],
  );
  const bars = useMemo(
    () =>
      [...shown]
        .filter((each) => each.latest)
        .sort((a, b) => (b.latest?.value ?? 0) - (a.latest?.value ?? 0))
        .slice(0, BARS),
    [shown],
  );

  // A span names the series the live chart draws; a product with few series gets every one.
  const summaryKeys = mixed || series.length > CHARTED ? charted.map((each) => each.key) : [];
  const summaryPath = timeWindow ? productPath(product.slug, `/series/summary?${summaryQuery(timeWindow, summaryKeys)}`) : null;
  const summary = useQuery(summaryPath, () => apiGet<SeriesSummary>(summaryPath ?? ""));
  const lineKeys = useMemo(
    () => (summary.data && summary.data.series.length > 0 ? summary.data.series.map((each) => each.seriesKey) : charted.map((each) => each.key)).slice(0, CHARTED),
    [summary.data, charted],
  );

  // Summaries end with the last summarised Lisbon day; each line's own live points carry it on from there.
  const until = summary.data?.coverage.until ?? null;
  const tailFrom = timeWindow && summary.data ? (until && until > timeWindow.from ? until : timeWindow.from) : undefined;
  const tailKey =
    timeWindow && tailFrom && tailFrom < timeWindow.to && lineKeys.length > 0 ? `series-tail:${product.slug}:${tailFrom}:${timeWindow.to}:${lineKeys.join("|")}` : null;
  const tail = useQuery(tailKey, () =>
    Promise.all(
      lineKeys.map((key) =>
        apiGet<CursorPage<SeriesPoint>>(
          productPath(product.slug, `/series?${new URLSearchParams({ seriesKey: key, from: tailFrom ?? "", to: timeWindow?.to ?? "", limit: "1000" })}`),
        ).then((page) => page.data),
      ),
    ).then((pages) => pages.flat()),
  );

  const lines = useMemo<SummaryLine[]>(() => {
    const data = summary.data;
    if (!timeWindow || !data) return [];
    return lineKeys
      .map((key) => {
        const points = (tail.data ?? []).filter((point) => point.seriesKey === key);
        const buckets = data.series.find((each) => each.seriesKey === key)?.buckets ?? [];
        return { key, label: series.find((each) => each.key === key)?.label ?? key, buckets: withLive(buckets, points, data.resolution), live: points.length > 0 };
      })
      .filter((line) => line.buckets.length > 0);
  }, [timeWindow, summary.data, tail.data, lineKeys, series]);

  const summaryRows = useMemo<SummaryRow[]>(() => lines.flatMap((line) => line.buckets.map((bucket) => ({ key: line.key, label: line.label, ...bucket }))), [lines]);

  const apply = () => {
    if (!picked?.from || !picked.to) return;
    const from = new Date(picked.from);
    from.setHours(0, 0, 0, 0);
    const to = new Date(picked.to);
    to.setHours(0, 0, 0, 0);
    to.setDate(to.getDate() + 1);
    setSpan({ kind: "custom", window: { from: from.toISOString(), to: to.toISOString() } });
    setPicking(false);
  };
  const choose = (next: Span) => {
    setSpan(next);
    setPicking(false);
  };

  const columns = useMemo<Column<SeriesPoint>[]>(
    () => [
      { key: "series", header: "Series", cell: (point) => seriesLabel(point), sort: (point) => seriesLabel(point) },
      { key: "eventTime", header: "Event time", cell: (point) => fmt.dateTime(point.eventTime), sort: (point) => point.eventTime, mono: true },
      { key: "value", header: mixed ? "Value" : `Value${unit ? ` (${unit})` : ""}`, cell: (point) => fmt.cell(point.value, "number"), sort: (point) => point.value, align: "end" },
      ...(mixed ? [{ key: "unit", header: "Unit", cell: (point: SeriesPoint) => point.unit, sort: (point: SeriesPoint) => point.unit }] : []),
      { key: "observedAt", header: "Observed", cell: (point) => <RelativeTime value={point.observedAt} />, sort: (point) => point.observedAt, mono: true },
    ],
    [unit, mixed],
  );
  const resolution = summary.data?.resolution ?? "hour";
  const summaryColumns = useMemo<Column<SummaryRow>[]>(
    () => [
      { key: "series", header: "Series", cell: (row) => row.label, sort: (row) => row.label },
      { key: "start", header: "Period", cell: (row) => periodLabel(row.start, resolution), sort: (row) => row.start, mono: true },
      { key: "mean", header: `Average${unit ? ` (${unit})` : ""}`, cell: (row) => fmt.cell(row.mean, "number"), sort: (row) => row.mean, align: "end" },
      { key: "min", header: "Lowest", cell: (row) => fmt.cell(row.min, "number"), sort: (row) => row.min, align: "end" },
      { key: "max", header: "Highest", cell: (row) => fmt.cell(row.max, "number"), sort: (row) => row.max, align: "end" },
      { key: "count", header: "Points", cell: (row) => fmt.int(row.count), sort: (row) => row.count, align: "end" },
    ],
    [unit, resolution],
  );

  if (current.loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-kumo-subtle">
        <Loader size="sm" /> Loading series…
      </div>
    );
  }
  if (current.error && points.length === 0) return <ErrorNote error={current.error} what="the series" onRetry={() => void current.refetch()} />;
  if (points.length === 0)
    return (
      <Empty icon={<ChartLineIcon size={40} className="text-kumo-inactive" />} title="No points yet" description="Series points appear after the first successful collection." />
    );

  const oldest = shown.flatMap((each) => each.points.map((point) => point.eventTime)).sort()[0];
  const coverage = summary.data?.coverage;
  // A span reaching well before the product's history is labelled from where its history begins.
  const firstStart = lines
    .map((line) => line.buckets[0]?.start ?? "")
    .filter(Boolean)
    .sort()[0];
  const shownFrom = timeWindow && firstStart && Date.parse(firstStart) - Date.parse(timeWindow.from) > 31 * DAY ? firstStart : undefined;
  const coverageNote = (() => {
    if (!timeWindow)
      return snapshot
        ? `Latest value of the ${Math.min(BARS, bars.length)} largest series`
        : shown.length > CHARTED
          ? `${CHARTED} of ${fmt.int(shown.length)} series drawn; the table has all of them`
          : "Hover for values";
    if (summary.error) return `Could not load this span: ${summary.error.message}`;
    if (!coverage) return "";
    if (!coverage.through) return "Summaries appear a day after each day ends; until then the chart shows live points.";
    if (tail.error) return `Could not load the latest points: ${tail.error.message}`;
    return lines.some((line) => line.live) ? "The last day or two come from live points" : "";
  })();

  return (
    <div className="grid gap-5">
      {withHistory ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Time span">
            <Button size="sm" variant={span.kind === "live" ? "primary" : "secondary"} aria-pressed={span.kind === "live"} onClick={() => choose({ kind: "live" })}>
              Live
            </Button>
            {PRESETS.map((preset) => {
              const active = span.kind === "preset" && span.preset.id === preset.id;
              return (
                <Button key={preset.id} size="sm" variant={active ? "primary" : "secondary"} aria-pressed={active} onClick={() => choose({ kind: "preset", preset })}>
                  {preset.label}
                </Button>
              );
            })}
            <Button
              size="sm"
              variant={span.kind === "custom" || picking ? "primary" : "secondary"}
              icon={<CalendarBlankIcon />}
              aria-expanded={picking}
              onClick={() => setPicking((open) => !open)}
            >
              {span.kind === "custom" ? `${dayLabel(span.window.from)} – ${dayLabel(Date.parse(span.window.to) - DAY)}` : "Dates…"}
            </Button>
          </div>
          {picking ? (
            <LayerCard>
              <LayerCard.Primary className="grid justify-items-start gap-3">
                <DatePicker mode="range" selected={picked} onChange={setPicked} numberOfMonths={window.innerWidth >= 640 ? 2 : 1} disabled={{ after: new Date() }} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" disabled={!picked?.from || !picked.to} onClick={apply}>
                    Show these dates
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
                    Cancel
                  </Button>
                </div>
              </LayerCard.Primary>
            </LayerCard>
          ) : null}
        </div>
      ) : null}

      {mixed ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Unit">
          {units.map((each) => (
            <Button key={each} size="sm" variant={each === unit ? "primary" : "secondary"} aria-pressed={each === unit} onClick={() => setPickedUnit(each)}>
              {each || "No unit"}
            </Button>
          ))}
        </div>
      ) : null}

      <LayerCard>
        <LayerCard.Secondary className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span>
            {timeWindow
              ? `${summary.data ? RESOLUTION_LABEL[summary.data.resolution] : "Loading"} · ${shownFrom ? periodLabel(shownFrom, resolution === "month" ? "month" : "day") : dayLabel(timeWindow.from)} – ${dayLabel(Date.parse(timeWindow.to) - 1)}${unit ? ` · ${unit}` : ""}`
              : `${unit || "Value"} · ${fmt.int(shown.reduce((total, each) => total + each.points.length, 0))} points in ${fmt.int(shown.length)} series${oldest ? ` · since ${fmt.date(oldest)}` : ""}`}
          </span>
          <span className="text-kumo-subtle">{coverageNote}</span>
        </LayerCard.Secondary>
        <LayerCard.Primary>
          {timeWindow ? (
            summary.loading ? (
              <div className="flex h-[380px] items-center justify-center gap-2 text-sm text-kumo-subtle">
                <Loader size="sm" /> Loading this span…
              </div>
            ) : lines.length === 0 ? (
              <Empty
                icon={<ChartLineIcon size={40} className="text-kumo-inactive" />}
                title="Nothing in this span"
                description="No summarised or live points fall between these dates."
              />
            ) : (
              <Chart echarts={echarts} isDarkMode={dark} height={380} options={summaryOptions(lines, palette, unit, summary.data?.resolution ?? "hour")} />
            )
          ) : snapshot ? (
            <Chart
              echarts={echarts}
              isDarkMode={dark}
              height={Math.max(260, bars.length * 26 + 60)}
              options={{
                grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
                tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
                // Every bar carries its own value, so narrow screens drop the axis figures instead of crowding them.
                xAxis: { type: "value", splitNumber: 4, axisLabel: { show: window.innerWidth >= 640, formatter: (value: number) => fmt.compact(value) } },
                // Labels take at most about a third of a phone screen; the tooltip carries the full name.
                yAxis: {
                  type: "category",
                  inverse: true,
                  data: bars.map((each) => each.label),
                  axisLabel: { width: Math.min(260, Math.round(window.innerWidth * 0.34)), overflow: "truncate" },
                },
                series: [
                  {
                    type: "bar",
                    data: bars.map((each) => each.latest?.value ?? 0),
                    itemStyle: { color: palette[0], borderRadius: [0, 4, 4, 0] },
                    barMaxWidth: 18,
                    label: { show: true, position: "right", formatter: ({ value }) => fmt.compact(Number(value)) },
                  },
                ],
              }}
            />
          ) : (
            <TimeseriesChart
              echarts={echarts}
              isDarkMode={dark}
              height={380}
              gradient={charted.length === 1}
              yAxisName={unit}
              tooltipMaxItems={CHARTED}
              tooltipValueFormat={(value: number) => `${fmt.cell(value, "number")}${unit ? ` ${unit}` : ""}`}
              ariaDescription={`${product.title}: ${charted.map((each) => each.label).join(", ")}`}
              data={charted.map((each, index) => ({
                name: each.label,
                color: palette[index % palette.length] ?? "#1b7a4f",
                data: each.points.map((point): [number, number] => [Date.parse(point.eventTime), point.value ?? 0]),
              }))}
            />
          )}
        </LayerCard.Primary>
      </LayerCard>

      {timeWindow && summaryRows.length > 0 ? (
        <DataTable
          label={`${product.title} summaries`}
          rows={summaryRows}
          columns={summaryColumns}
          rowKey={(row) => `${row.key}|${row.start}`}
          initialSort={{ key: "start", direction: "desc" }}
          exportRow={(row) => ({
            seriesKey: row.key,
            series: row.label,
            start: row.start,
            resolution,
            mean: row.mean,
            min: row.min,
            max: row.max,
            count: row.count,
            unit: unit || null,
          })}
          onRowClick={(row) =>
            setOpened({
              title: row.label,
              row: { series: row.label, seriesKey: row.key, start: row.start, resolution, points: row.count, mean: row.mean, min: row.min, max: row.max, unit: unit || null },
            })
          }
          downloadName={`${product.slug}-summary-${resolution}`}
        />
      ) : (
        <DataTable
          label={`${product.title} points`}
          rows={points}
          columns={columns}
          rowKey={pointKey}
          initialSort={{ key: "eventTime", direction: "desc" }}
          exportRow={(point) => ({
            seriesKey: point.seriesKey,
            series: seriesLabel(point),
            eventTime: point.eventTime,
            value: point.value,
            unit: point.unit ?? null,
            observedAt: point.observedAt ?? null,
          })}
          onRowClick={(point) => setOpened({ row: pointRecord(point), title: seriesLabel(point) })}
          downloadName={`${product.slug}-series`}
        />
      )}
      <RowDialog row={opened?.row ?? null} title={opened?.title} onClose={() => setOpened(null)} />
    </div>
  );
}

function summaryQuery(window: TimeWindow, seriesKeys: string[]) {
  const query = new URLSearchParams({ from: window.from, to: window.to });
  for (const key of seriesKeys) query.append("seriesKey", key);
  return query.toString();
}
