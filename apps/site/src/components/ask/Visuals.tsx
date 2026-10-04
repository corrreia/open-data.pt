import { Chart, TimeseriesChart } from "@cloudflare/kumo";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { z } from "zod";
import type { ChartSpec, MapSpec, TableSpec, Visual } from "../../lib/ask";
import { echarts } from "../../lib/echarts";
import { fmt, isNumber, isRecord } from "../../lib/format";
import { SERIES_COLORS } from "../../lib/palette";
import { useDarkMode } from "../common";

// What the agent's code drew with ui.chart, ui.map and ui.table, under its answer. The model wrote
// these specs, so every label is shown as text and nothing in them is read as markup.

/* ---------- Charts ---------- */

/** A time on a line chart: an ISO time, or milliseconds since 1970. */
const instant = (x: string | number) => (isNumber(x) ? x : Date.parse(x));

function ChartVisual({ spec }: { spec: ChartSpec }) {
  const dark = useDarkMode();
  const palette = dark ? SERIES_COLORS.dark : SERIES_COLORS.light;
  const unit = spec.unit ? ` ${spec.unit}` : "";
  if (spec.kind === "line") {
    return (
      <TimeseriesChart
        echarts={echarts}
        isDarkMode={dark}
        height={240}
        gradient={spec.series.length === 1}
        yAxisName={spec.unit}
        tooltipValueFormat={(value: number) => `${fmt.cell(value, "number")}${unit}`}
        ariaDescription={`${spec.title}: ${spec.series.map((each) => each.name).join(", ")}`}
        data={spec.series.map((each, index) => ({
          name: each.name,
          color: palette[index % palette.length] ?? "#1b7a4f",
          data: each.points.flatMap(([x, y]): Array<[number, number]> => (y === null || Number.isNaN(instant(x)) ? [] : [[instant(x), y]])),
        }))}
      />
    );
  }
  // Bars run sideways, so long category names stay readable in a narrow panel.
  const categories = [...new Set(spec.series.flatMap((each) => each.points.map(([x]) => String(x))))];
  return (
    <Chart
      echarts={echarts}
      isDarkMode={dark}
      height={Math.min(560, Math.max(160, categories.length * spec.series.length * 20 + 60))}
      options={{
        grid: { left: 8, right: 48, top: spec.series.length > 1 ? 28 : 8, bottom: 8, containLabel: true },
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value) => `${fmt.cell(Number(value), "number")}${unit}` },
        legend: { show: spec.series.length > 1, top: 0 },
        xAxis: { type: "value", splitNumber: 3, axisLabel: { formatter: (value: number) => fmt.compact(value) } },
        yAxis: { type: "category", inverse: true, data: categories, axisLabel: { width: 140, overflow: "truncate" } },
        series: spec.series.map((each, index) => {
          const values = new Map(each.points.map(([x, y]) => [String(x), y]));
          return {
            name: each.name,
            type: "bar",
            data: categories.map((category) => values.get(category) ?? null),
            itemStyle: { color: palette[index % palette.length], borderRadius: [0, 4, 4, 0] },
            barMaxWidth: 16,
          };
        }),
      }}
    />
  );
}

/* ---------- Maps ---------- */

/*
 * OpenStreetMap's standard tiles, which need no key, as on the product pages. Their usage policy asks
 * for a Referer, so the layer sets its own referrer policy.
 */
const OSM = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * Low to high, for points the model gave a value: viridis, light yellow to dark violet. Its lightness
 * falls steadily, so low and high stay apart without telling hues apart, colour blindness included.
 */
const RAMP = ["#fde725", "#5ec962", "#21918c", "#3b528b", "#440154"];
/** A dark rim, so the lightest points stand out from light map tiles too. */
const RIM = "#1f2421";

/** A label as plain text inside a popup: Leaflet sets popups as HTML, so the model's words are escaped. */
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

const POSITION = z.array(z.number()).min(2).max(3);
const GEOMETRY = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Point"), coordinates: POSITION }),
  z.object({ type: z.literal("MultiPoint"), coordinates: z.array(POSITION) }),
  z.object({ type: z.literal("LineString"), coordinates: z.array(POSITION) }),
  z.object({ type: z.literal("MultiLineString"), coordinates: z.array(z.array(POSITION)) }),
  z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(POSITION)) }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(z.array(POSITION))) }),
]);
const FEATURE = z.object({ type: z.literal("Feature"), geometry: GEOMETRY, properties: z.record(z.string(), z.json()).nullish() });

/** A feature the map can draw, or none: one without a geometry, or with a kind Leaflet cannot draw, is left out rather than failing the map. */
function drawableFeature(value: NonNullable<MapSpec["geojson"]>["features"][number]): GeoJSON.Feature[] {
  const parsed = FEATURE.safeParse(value);
  return parsed.success ? [{ type: "Feature", geometry: parsed.data.geometry, properties: parsed.data.properties ?? null }] : [];
}

function MapVisual({ spec }: { spec: MapSpec }) {
  const element = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!element.current) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Inside a scrolling conversation a swipe or the wheel scrolls the conversation: on a touch screen the map zooms with a pinch or its buttons, and does not pan.
    const map = L.map(element.current, {
      preferCanvas: true,
      zoomAnimation: !still,
      fadeAnimation: !still,
      markerZoomAnimation: !still,
      scrollWheelZoom: false,
      dragging: !L.Browser.mobile,
    });
    L.tileLayer(OSM, { maxZoom: 19, attribution: ATTRIBUTION, referrerPolicy: "strict-origin-when-cross-origin", crossOrigin: true }).addTo(map);
    const drawn = L.featureGroup().addTo(map);

    const points = spec.points ?? [];
    const values = points.flatMap((point) => (point.value === undefined ? [] : [point.value]));
    const low = Math.min(...values);
    const high = Math.max(...values);
    const colourOf = (value: number | undefined) => {
      if (value === undefined || high === low) return RAMP[0];
      return RAMP[Math.min(RAMP.length - 1, Math.floor(((value - low) / (high - low)) * RAMP.length))];
    };
    for (const point of points) {
      const marker = L.circleMarker([point.lat, point.lon], { radius: 6, weight: 1, color: RIM, fillColor: colourOf(point.value), fillOpacity: 0.9 });
      const label = [point.label, point.value === undefined ? undefined : fmt.cell(point.value, "number")].filter(Boolean).join(" · ");
      if (label) marker.bindPopup(escapeHtml(label));
      marker.addTo(drawn);
    }
    if (spec.geojson) {
      const collection: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: spec.geojson.features.flatMap(drawableFeature) };
      L.geoJSON(collection, {
        style: { color: RAMP[2], weight: 2, fillOpacity: 0.2 },
        pointToLayer: (_, at) => L.circleMarker(at, { radius: 5, weight: 1, color: RIM, fillColor: RAMP[2], fillOpacity: 0.9 }),
        onEachFeature: (feature, layer) => {
          const name = feature.properties?.name ?? feature.properties?.title;
          if (name) layer.bindPopup(escapeHtml(String(name)));
        },
      }).addTo(drawn);
    }
    const bounds = drawn.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [16, 16], maxZoom: 15 });
    else map.setView([39.6, -8], 6);
    return () => {
      map.remove();
    };
  }, [spec]);

  const values = (spec.points ?? []).flatMap((point) => (point.value === undefined ? [] : [point.value]));
  return (
    <div className="grid gap-1.5">
      {/* Leaflet's own zoom buttons and attribution links stay reachable; the figure's caption names the map. */}
      <div ref={element} className="h-64 w-full overflow-hidden rounded-lg border border-kumo-line" />
      {values.length ? (
        <div className="flex items-center gap-2 text-xs text-kumo-subtle">
          <span>
            <span className="sr-only">Colour runs from low, </span>
            {fmt.cell(Math.min(...values), "number")}
          </span>
          <span className="h-2 flex-1 rounded-full" aria-hidden="true" style={{ background: `linear-gradient(to right, ${RAMP.join(", ")})` }} />
          <span>
            <span className="sr-only">to high, </span>
            {fmt.cell(Math.max(...values), "number")}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Tables ---------- */

function TableVisual({ spec }: { spec: TableSpec }) {
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-kumo-line">
      <table className="w-full border-collapse text-xs tabular-nums">
        <thead className="sticky top-0 bg-kumo-recessed">
          <tr>
            {spec.columns.map((column, index) => (
              <th key={index} scope="col" className="px-2 py-1.5 text-left font-medium text-kumo-strong">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-kumo-line">
              {spec.columns.map((_, index) => (
                <td key={index} className="px-2 py-1.5 text-kumo-default">
                  {fmt.cell(row[index] ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Every drawing as a table too ---------- */

/** Rows a "Show as a table" lists; a longer drawing says how many it left out. */
const MAX_TABLE_ROWS = 500;

/** A chart's points as rows: one per time or category, one column per series. */
function chartTable(spec: ChartSpec): TableSpec {
  // A bar chart groups categories by their text, so 1 and "1" are one bar and must be one row.
  const key = (x: string | number) => (spec.kind === "bar" ? String(x) : x);
  const xs = [...new Set(spec.series.flatMap((each) => each.points.map(([x]) => key(x))))];
  const bySeries = spec.series.map((each) => new Map(each.points.map(([x, y]) => [key(x), y])));
  return {
    title: spec.title,
    columns: [spec.kind === "line" ? "Time" : "Category", ...spec.series.map((each) => (spec.unit ? `${each.name} (${spec.unit})` : each.name))],
    rows: xs.map((x) => [spec.kind === "line" ? fmt.dateTime(instant(x)) : String(x), ...bySeries.map((values) => values.get(x) ?? null)]),
  };
}

/** A map's points as rows (what each is, its value when it has one, and where it is), then its GeoJSON features. */
function mapTable(spec: MapSpec): TableSpec | undefined {
  const points = spec.points ?? [];
  const features = (spec.geojson?.features ?? []).flatMap(drawableFeature);
  if (!points.length) return features.length ? featureTable(spec.title, features) : undefined;
  const valued = points.some((point) => point.value !== undefined);
  return {
    title: spec.title,
    columns: valued ? ["Place", "Value", "Latitude", "Longitude"] : ["Place", "Latitude", "Longitude"],
    rows: points.map((point) => (valued ? [point.label ?? "", point.value ?? null, point.lat, point.lon] : [point.label ?? "", point.lat, point.lon])),
  };
}

/** A feature's own words, as far as a table cell goes: its name, then a few of its properties. */
function featureTable(title: string, features: GeoJSON.Feature[]): TableSpec {
  const describe = (properties: GeoJSON.GeoJsonProperties) =>
    Object.entries(properties ?? {})
      .filter(([, value]) => value !== null && value !== undefined && !Array.isArray(value) && !isRecord(value))
      .slice(0, 4)
      .map(([name, value]) => `${name}: ${String(value)}`)
      .join(" · ");
  return {
    title,
    columns: ["Name", "Shape", "Details"],
    rows: features.map((feature) => [String(feature.properties?.name ?? feature.properties?.title ?? feature.id ?? ""), feature.geometry.type, describe(feature.properties)]),
  };
}

/** The values behind a chart or map, for anyone who cannot point at them: screen readers, keyboards, cut-off labels. */
function AsTable({ spec }: { spec: TableSpec | undefined }) {
  if (!spec?.rows.length) return null;
  const shown = spec.rows.length > MAX_TABLE_ROWS ? { ...spec, rows: spec.rows.slice(0, MAX_TABLE_ROWS) } : spec;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer py-1 text-kumo-subtle hover:text-kumo-strong">Show as a table</summary>
      <div className="mt-2 grid gap-1">
        <TableVisual spec={shown} />
        {shown !== spec ? (
          <p className="text-kumo-subtle">
            The first {fmt.int(MAX_TABLE_ROWS)} of {fmt.int(spec.rows.length)} rows.
          </p>
        ) : null}
      </div>
    </details>
  );
}

export default function Visuals({ visuals }: { visuals: Visual[] }) {
  return (
    <div className="grid gap-4">
      {visuals.map((visual, index) => (
        <figure key={index} className="grid gap-1.5">
          <figcaption className="text-xs font-medium text-kumo-strong">{visual.spec.title}</figcaption>
          {visual.kind === "chart" ? (
            <>
              <ChartVisual spec={visual.spec} />
              <AsTable spec={chartTable(visual.spec)} />
            </>
          ) : visual.kind === "map" ? (
            <>
              <MapVisual spec={visual.spec} />
              <AsTable spec={mapTable(visual.spec)} />
            </>
          ) : (
            <TableVisual spec={visual.spec} />
          )}
        </figure>
      ))}
    </div>
  );
}
