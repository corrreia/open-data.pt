import { Chart, TimeseriesChart } from "@cloudflare/kumo";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { z } from "zod";
import type { ChartSpec, MapSpec, TableSpec, Visual } from "../../lib/ask";
import { echarts } from "../../lib/echarts";
import { fmt, isNumber } from "../../lib/format";
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

/** Low to high, for points the model gave a value: green through amber to red. */
const RAMP = ["#1b7a4f", "#5b8a1e", "#8f6c12", "#c46a1b", "#b3405e"];

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
    const map = L.map(element.current, { preferCanvas: true, zoomAnimation: !still, fadeAnimation: !still, markerZoomAnimation: !still, scrollWheelZoom: false });
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
      const marker = L.circleMarker([point.lat, point.lon], { radius: 6, weight: 1, color: "#ffffff", fillColor: colourOf(point.value), fillOpacity: 0.9 });
      const label = [point.label, point.value === undefined ? undefined : fmt.cell(point.value, "number")].filter(Boolean).join(" · ");
      if (label) marker.bindPopup(escapeHtml(label));
      marker.addTo(drawn);
    }
    if (spec.geojson) {
      const collection: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: spec.geojson.features.flatMap(drawableFeature) };
      L.geoJSON(collection, {
        style: { color: RAMP[0], weight: 2, fillOpacity: 0.2 },
        pointToLayer: (_, at) => L.circleMarker(at, { radius: 5, weight: 1, color: "#ffffff", fillColor: RAMP[0], fillOpacity: 0.9 }),
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
      <div ref={element} className="h-64 w-full overflow-hidden rounded-lg border border-kumo-line" role="img" aria-label={spec.title} />
      {values.length ? (
        <div className="flex items-center gap-2 text-xs text-kumo-subtle" aria-hidden="true">
          <span>{fmt.cell(Math.min(...values), "number")}</span>
          <span className="h-2 flex-1 rounded-full" style={{ background: `linear-gradient(to right, ${RAMP.join(", ")})` }} />
          <span>{fmt.cell(Math.max(...values), "number")}</span>
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

export default function Visuals({ visuals }: { visuals: Visual[] }) {
  return (
    <div className="grid gap-4">
      {visuals.map((visual, index) => (
        <figure key={index} className="grid gap-1.5">
          <figcaption className="text-xs font-medium text-kumo-strong">{visual.spec.title}</figcaption>
          {visual.kind === "chart" ? <ChartVisual spec={visual.spec} /> : visual.kind === "map" ? <MapVisual spec={visual.spec} /> : <TableVisual spec={visual.spec} />}
        </figure>
      ))}
    </div>
  );
}
