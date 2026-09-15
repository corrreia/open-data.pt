import { Button, Chart, Empty, LayerCard, Loader, TimeseriesChart } from "@cloudflare/kumo";
import { ChartLineIcon, ClockCounterClockwiseIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { DataTable, type Column } from "../DataTable";
import { RelativeTime, useDarkMode } from "../common";
import { apiGet, productPath } from "../../lib/api";
import { echarts } from "../../lib/echarts";
import { SERIES_COLORS } from "../../lib/palette";
import { fmt } from "../../lib/format";
import { useQuery } from "../../lib/query";
import type { Page, Product, SeriesPoint } from "../../lib/types";
import { seriesLabel } from "./cells";

const CHARTED = 10;
const BARS = 25;
const YEAR_MS = 365 * 86_400_000;

interface Series {
  key: string;
  label: string;
  points: SeriesPoint[];
  latest: SeriesPoint | undefined;
}

const pointKey = (point: SeriesPoint) => `${point.seriesKey}|${point.eventTime}`;

export default function SeriesView({ product, refreshKey, withHistory }: { product: Product; refreshKey: number; withHistory: boolean }) {
  const dark = useDarkMode();
  const current = useQuery(`series:${product.slug}`, () => apiGet<Page<SeriesPoint>>(productPath(product.slug, "/series?limit=1000")).then((page) => page.data));
  const [history, setHistory] = useState<SeriesPoint[]>([]);
  const [windowTo, setWindowTo] = useState<string>();
  const [cursor, setCursor] = useState<string>();
  const [emptyWindows, setEmptyWindows] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyNote, setHistoryNote] = useState("Older points live in the lake and load on demand.");
  const exhausted = emptyWindows >= 3;

  useEffect(() => {
    if (refreshKey > 0) void current.refetch();
  }, [refreshKey]);

  const points = useMemo(() => {
    const live = current.data ?? [];
    const known = new Set(live.map(pointKey));
    return [...live, ...history.filter((point) => !known.has(pointKey(point)))];
  }, [current.data, history]);

  const series = useMemo<Series[]>(() => {
    const groups = new Map<string, SeriesPoint[]>();
    for (const point of points) groups.set(point.seriesKey, [...(groups.get(point.seriesKey) ?? []), point]);
    return [...groups.entries()].map(([key, group]) => {
      const ordered = group.filter((point) => point.value !== null).sort((a, b) => a.eventTime.localeCompare(b.eventTime));
      const first = group[0];
      return { key, label: first ? seriesLabel(first) : key, points: ordered, latest: ordered.at(-1) };
    });
  }, [points]);

  const unit = points.find((point) => point.unit)?.unit ?? "";
  const palette = dark ? SERIES_COLORS.dark : SERIES_COLORS.light;
  // A series with one or two points is a snapshot: compare the latest values instead of drawing flat lines.
  const snapshot = series.length > 0 && series.every((each) => each.points.length <= 2);
  const charted = useMemo(
    () => [...series].sort((a, b) => b.points.length - a.points.length || Math.abs(b.latest?.value ?? 0) - Math.abs(a.latest?.value ?? 0)).slice(0, CHARTED),
    [series],
  );
  const bars = useMemo(() => [...series].filter((each) => each.latest).sort((a, b) => (b.latest?.value ?? 0) - (a.latest?.value ?? 0)).slice(0, BARS), [series]);

  const loadEarlier = async () => {
    setLoadingHistory(true);
    setHistoryNote("Loading older points from the lake…");
    try {
      let to = windowTo ?? points.map((point) => point.eventTime).sort()[0] ?? new Date().toISOString();
      let after = cursor;
      let empties = emptyWindows;
      let fresh: SeriesPoint[] = [];
      const known = new Set(points.map(pointKey));
      // History windows span at most a year; three empty years in a row mean the lake holds nothing older.
      while (fresh.length === 0 && empties < 3) {
        const from = new Date(Date.parse(to) - YEAR_MS).toISOString();
        const query = new URLSearchParams({ limit: "1000", from, to });
        if (after) query.set("cursor", after);
        const page = await apiGet<Page<SeriesPoint>>(productPath(product.slug, `/series/range?${query}`));
        fresh = page.data.filter((point) => !known.has(pointKey(point)));
        after = page.nextCursor ?? undefined;
        if (!after) {
          to = from;
          empties = fresh.length === 0 ? empties + 1 : 0;
        }
      }
      setHistory((existing) => [...existing, ...fresh]);
      setWindowTo(to);
      setCursor(after);
      setEmptyWindows(empties);
      const oldest = fresh.map((point) => point.eventTime).sort()[0];
      setHistoryNote(fresh.length === 0 ? "No earlier points in the lake." : `Loaded ${fmt.int(fresh.length)} older points, back to ${fmt.date(oldest)}.`);
    } catch (failure) {
      setHistoryNote(`Could not load history: ${failure instanceof Error ? failure.message : "unknown error"}`);
    } finally {
      setLoadingHistory(false);
    }
  };

  const columns = useMemo<Column<SeriesPoint>[]>(
    () => [
      { key: "series", header: "Series", cell: (point) => seriesLabel(point), sort: (point) => seriesLabel(point) },
      { key: "eventTime", header: "Event time", cell: (point) => fmt.dateTime(point.eventTime), sort: (point) => point.eventTime, mono: true },
      { key: "value", header: `Value${unit ? ` (${unit})` : ""}`, cell: (point) => fmt.cell(point.value, "number"), sort: (point) => point.value, align: "end" },
      { key: "observedAt", header: "Observed", cell: (point) => <RelativeTime value={point.observedAt} />, sort: (point) => point.observedAt, mono: true },
    ],
    [unit],
  );

  if (current.loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-kumo-subtle">
        <Loader size="sm" /> Loading series…
      </div>
    );
  }
  if (current.error && points.length === 0) return <Empty icon={<ChartLineIcon size={40} className="text-kumo-inactive" />} title="Could not load the series" description={current.error.message} />;
  if (points.length === 0) return <Empty icon={<ChartLineIcon size={40} className="text-kumo-inactive" />} title="No points yet" description="Series points appear after the first successful collection." />;

  const oldest = points.map((point) => point.eventTime).sort()[0];

  return (
    <div className="grid gap-5">
      <LayerCard>
        <LayerCard.Secondary className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span>
            {unit || "Value"} · {fmt.int(points.length)} points in {fmt.int(series.length)} series{history.length ? ` · ${fmt.int(history.length)} from the lake` : ""}
            {oldest ? ` · since ${fmt.date(oldest)}` : ""}
          </span>
          <span className="text-kumo-subtle">
            {snapshot ? `Latest value of the ${Math.min(BARS, bars.length)} largest series` : series.length > CHARTED ? `${CHARTED} of ${fmt.int(series.length)} series drawn; the table has all of them` : "Hover for values"}
          </span>
        </LayerCard.Secondary>
        <LayerCard.Primary>
          {snapshot ? (
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
                yAxis: { type: "category", inverse: true, data: bars.map((each) => each.label), axisLabel: { width: Math.min(260, Math.round(window.innerWidth * 0.34)), overflow: "truncate" } },
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

      {withHistory ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" icon={<ClockCounterClockwiseIcon />} loading={loadingHistory} disabled={exhausted} onClick={loadEarlier}>
            Load earlier history
          </Button>
          <span className="text-xs text-kumo-subtle">{historyNote}</span>
        </div>
      ) : null}

      <DataTable
        label={`${product.title} points`}
        rows={points}
        columns={columns}
        rowKey={pointKey}
        initialSort={{ key: "eventTime", direction: "desc" }}
        exportRow={(point) => ({ seriesKey: point.seriesKey, series: seriesLabel(point), eventTime: point.eventTime, value: point.value, unit: point.unit ?? null, observedAt: point.observedAt ?? null })}
        downloadName={`${product.slug}-series`}
      />
    </div>
  );
}
