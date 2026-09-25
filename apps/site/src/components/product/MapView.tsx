import { Button, Loader, Select } from "@cloudflare/kumo";
import { CrosshairIcon } from "@phosphor-icons/react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorNote, RelativeTime, useDarkMode } from "../common";
import { apiGet, productPath } from "../../lib/api";
import { NO_VALUE_COLORS, SERIES_COLORS } from "../../lib/palette";
import { fmt, humanize, isRecord } from "../../lib/format";
import { useQuery } from "../../lib/query";
import type { Feature, FeatureCollection, Field, Geometry, JsonRecord, JsonValue, Product } from "../../lib/types";
import { isText } from "./cells";

/*
 * Basemap: OpenStreetMap's standard tiles, which need no key. Their usage policy asks for a Referer,
 * so the layer sets its own referrer policy rather than inheriting whatever the page or the browser
 * strips. Dark mode darkens the same tiles with a CSS filter (styles.css), so both themes share one
 * tile cache.
 */
const OSM = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Above this many points, positions jump to their new place instead of gliding there. */
const GLIDE_LIMIT = 5000;
const GLIDE_MS = 700;

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ?? character);

function popupHtml(properties: JsonRecord) {
  const rows = Object.keys(properties)
    .filter((key) => key !== "id" && key !== "_time")
    .filter((key) => {
      const value = properties[key];
      return value !== null && value !== undefined && value !== "" && !Array.isArray(value) && !isRecord(value);
    })
    .slice(0, 8)
    .map((key) => `<dt>${escapeHtml(humanize(key).replace(/ ID$/, ""))}</dt><dd>${escapeHtml(fmt.cell(properties[key]))}</dd>`)
    .join("");
  const time = properties._time;
  const when = time && isRecord(time) ? (time.event ?? time.observed) : undefined;
  const title = properties.name ?? properties.title ?? properties.id;
  return `<strong>${escapeHtml(isText(title) || Number.isFinite(title) ? String(title) : "")}</strong>${isText(when) ? `<div style="opacity:.7">${escapeHtml(fmt.dateTime(when))}</div>` : ""}<dl>${rows}</dl>`;
}

/** Fields worth colouring by: a category with two values up to one per palette colour, so no two share a colour. */
function colourFields(fields: Field[], features: Feature[]) {
  return fields.filter((field) => {
    if (field.type !== "category") return false;
    const values = new Set(features.map((feature) => feature.properties[field.name]).filter((value) => value !== null && value !== undefined && value !== ""));
    return values.size >= 2 && values.size <= SERIES_COLORS.light.length;
  });
}

/**
 * A feature with no value in the colouring field. The sentinel cannot collide with a real
 * category, which "No value" itself could; that string is only its label.
 */
const NO_VALUE = "\u0000no-value";
const NO_VALUE_LABEL = "No value";
const categoryLabel = (category: string) => (category === NO_VALUE ? NO_VALUE_LABEL : category);

const GEOMETRY_TYPES = new Set(["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon"]);

/** The feature's geometry as Leaflet reads it, or null for a type RFC 7946 does not define. */
function toGeoJson(geometry: Geometry): GeoJSON.Geometry | null {
  if (geometry.type === "GeometryCollection") {
    return { type: "GeometryCollection", geometries: (geometry.geometries ?? []).map(toGeoJson).filter((item): item is GeoJSON.Geometry => item !== null) };
  }
  if (!GEOMETRY_TYPES.has(geometry.type) || !Array.isArray(geometry.coordinates)) return null;
  // SAFETY: the type is one RFC 7946 defines and the kernel's .geojson endpoint writes coordinates nested to match it.
  return { type: geometry.type, coordinates: geometry.coordinates } as GeoJSON.Geometry;
}

/** One `[lng, lat]` pair as the map's `[lat, lng]`, when it is a usable position. */
function positionOf(coordinates: JsonValue | undefined): [number, number] | null {
  if (!Array.isArray(coordinates)) return null;
  const [lng, lat] = coordinates.map(Number);
  return lat !== undefined && lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

/**
 * The positions of a feature that is points: one for a Point, each of a
 * MultiPoint's (many registers write every point as a MultiPoint of one).
 * Null for anything else, which is drawn as a line or an area.
 */
function pointsOf(feature: Feature): Array<[number, number]> | null {
  const { type, coordinates } = feature.geometry;
  if (type === "Point") {
    const position = positionOf(coordinates);
    return position ? [position] : null;
  }
  if (type !== "MultiPoint" || !Array.isArray(coordinates)) return null;
  const positions = coordinates.map(positionOf).filter((position): position is [number, number] => position !== null);
  return positions.length > 0 ? positions : null;
}

const isPoints = (feature: Feature) => feature.geometry.type === "Point" || feature.geometry.type === "MultiPoint";

// Wide enough for a species name or an address on one line; longer values wrap inside it.
const POPUP = { minWidth: 240, maxWidth: 360 } satisfies L.PopupOptions;

const outlineStyle = (color: string): L.PathOptions => ({ color, weight: 2, opacity: 0.85, fillColor: color, fillOpacity: 0.15 });

interface Plotted {
  index: number;
  lat: number;
  lng: number;
  fromLat: number;
  fromLng: number;
  category: string;
}

interface Paint {
  colors: Map<string, string>;
  hidden: Set<string>;
  outline: string;
  animate: boolean;
}

/** Web Mercator in 0..1 on both axes: multiply by 256 × 2^zoom for Leaflet's pixel space at that zoom. */
function mercator(lat: number, lng: number): [number, number] {
  const clamped = Math.max(-85.0511287798, Math.min(85.0511287798, lat)) * (Math.PI / 180);
  return [(lng + 180) / 360, (1 - Math.log(Math.tan(clamped) + 1 / Math.cos(clamped)) / Math.PI) / 2];
}

/**
 * Every point on one canvas. One Leaflet marker per point froze the page for seconds on the larger
 * datasets (70,000 trees). Positions are projected once per update into Mercator units, so a redraw
 * is arithmetic plus one batched path per colour, and a click finds the nearest point from the
 * positions of the last frame.
 */
class PointLayer extends L.Layer {
  private readonly canvas = document.createElement("canvas");
  private host: L.Map | undefined;
  private points: Plotted[] = [];
  private target = new Float64Array(0);
  private origin = new Float64Array(0);
  private screen = new Float32Array(0);
  private paint: Paint = { colors: new Map(), hidden: new Set(), outline: "#fff", animate: false };
  private started = 0;
  private frame = 0;

  constructor() {
    super();
    // Hidden while Leaflet animates a zoom; redrawn at the new scale when it ends.
    this.canvas.className = "leaflet-zoom-hide";
    this.canvas.style.position = "absolute";
    this.canvas.style.pointerEvents = "none";
  }

  override onAdd(map: L.Map): this {
    this.host = map;
    const pane = map.getPane("points") ?? map.createPane("points");
    pane.style.zIndex = "450";
    pane.style.pointerEvents = "none";
    pane.appendChild(this.canvas);
    map.on("moveend zoomend resize", this.reset, this);
    this.reset();
    return this;
  }

  override onRemove(map: L.Map): this {
    cancelAnimationFrame(this.frame);
    map.off("moveend zoomend resize", this.reset, this);
    this.canvas.remove();
    this.host = undefined;
    return this;
  }

  update(points: Plotted[], paint: Paint) {
    this.points = points;
    this.paint = paint;
    this.target = new Float64Array(points.length * 2);
    this.origin = new Float64Array(points.length * 2);
    this.screen = new Float32Array(points.length * 2);
    points.forEach((point, index) => {
      const [x, y] = mercator(point.lat, point.lng);
      const [fromX, fromY] = point.fromLat === point.lat && point.fromLng === point.lng ? [x, y] : mercator(point.fromLat, point.fromLng);
      this.target[index * 2] = x;
      this.target[index * 2 + 1] = y;
      this.origin[index * 2] = fromX;
      this.origin[index * 2 + 1] = fromY;
    });
    cancelAnimationFrame(this.frame);
    if (!paint.animate) return this.draw(1);
    this.started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - this.started) / GLIDE_MS);
      this.draw(t);
      if (t < 1) this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  /** The drawn point closest to a spot on the map, within `reach` pixels. */
  nearest(at: L.Point, reach: number): Plotted | undefined {
    let best: Plotted | undefined;
    let bestDistance = reach * reach;
    for (let index = 0; index < this.points.length; index += 1) {
      const x = this.screen[index * 2];
      const y = this.screen[index * 2 + 1];
      if (x === undefined || y === undefined || Number.isNaN(x)) continue;
      const distance = (x - at.x) ** 2 + (y - at.y) ** 2;
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = this.points[index];
      }
    }
    return best;
  }

  private reset() {
    const map = this.host;
    if (!map) return;
    const size = map.getSize();
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(size.x * ratio);
    this.canvas.height = Math.round(size.y * ratio);
    this.canvas.style.width = `${size.x}px`;
    this.canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(this.canvas, map.containerPointToLayerPoint([0, 0]));
    this.draw(1);
  }

  private draw(t: number) {
    const map = this.host;
    const context = this.canvas.getContext("2d");
    if (!map || !context) return;
    const size = map.getSize();
    const ratio = window.devicePixelRatio || 1;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.x, size.y);
    const count = this.points.length;
    const many = count > 3000;
    const radius = many ? (map.getZoom() >= 15 ? 4 : 2.5) : 5;
    // Squares rasterise several times faster than circles; at 5 px across, a crowd of them reads the same.
    const squares = count > 20_000;
    const ease = 1 - (1 - t) ** 3;
    // Container pixel = Mercator × 256 × 2^zoom − (pixel origin + the pane's offset from the container).
    const scale = 256 * 2 ** map.getZoom();
    const pixelOrigin = map.getPixelOrigin();
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    const offsetX = pixelOrigin.x + topLeft.x;
    const offsetY = pixelOrigin.y + topLeft.y;
    const paths = new Map<string, Path2D>();
    for (let index = 0; index < count; index += 1) {
      const point = this.points[index];
      this.screen[index * 2] = Number.NaN;
      if (!point || this.paint.hidden.has(point.category)) continue;
      const fromX = this.origin[index * 2] ?? 0;
      const fromY = this.origin[index * 2 + 1] ?? 0;
      const x = (fromX + ((this.target[index * 2] ?? 0) - fromX) * ease) * scale - offsetX;
      const y = (fromY + ((this.target[index * 2 + 1] ?? 0) - fromY) * ease) * scale - offsetY;
      if (x < -radius || y < -radius || x > size.x + radius || y > size.y + radius) continue;
      this.screen[index * 2] = x;
      this.screen[index * 2 + 1] = y;
      let path = paths.get(point.category);
      if (!path) {
        path = new Path2D();
        paths.set(point.category, path);
      }
      if (squares) {
        path.rect(x - radius, y - radius, radius * 2, radius * 2);
      } else {
        path.moveTo(x + radius, y);
        path.arc(x, y, radius, 0, Math.PI * 2);
      }
    }
    for (const [category, path] of paths) {
      context.fillStyle = this.paint.colors.get(category) ?? "#1b7a4f";
      context.globalAlpha = 0.9;
      context.fill(path);
      context.globalAlpha = 1;
      if (!many) {
        context.lineWidth = 1;
        context.strokeStyle = this.paint.outline;
        context.stroke(path);
      }
    }
  }
}

export default function MapView({ product, refreshKey }: { product: Product; refreshKey: number }) {
  const dark = useDarkMode();
  const geojson = useQuery(`geojson:${product.slug}`, () => apiGet<FeatureCollection>(productPath(product.slug, ".geojson")), { staleMs: 10_000 });
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pointsRef = useRef<PointLayer | null>(null);
  const areaLayerRef = useRef<L.GeoJSON | null>(null);
  const featuresRef = useRef<Feature[]>([]);
  const lastPositions = useRef(new Map<string, [number, number]>());
  const boundsRef = useRef<L.LatLngBounds | null>(null);
  const fittedRef = useRef(false);
  const [colourBy, setColourBy] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [fetchedAt, setFetchedAt] = useState<string>();

  const features = geojson.data?.features ?? [];
  const choices = useMemo(() => colourFields(product.schema.fields, features), [product.schema.fields, features]);
  const field = colourBy === null ? (choices[0]?.name ?? "") : colourBy;
  // A missing value is not a category: it is drawn grey and listed last, as "No value".
  const categoryOf = (feature: Feature) => {
    if (!field) return "all";
    const value = feature.properties[field];
    return value === null || value === undefined || value === "" ? NO_VALUE : String(value);
  };
  const categories = useMemo(() => {
    if (!field) return [];
    const found = [...new Set(features.map(categoryOf))];
    return [...found.filter((category) => category !== NO_VALUE).sort(), ...found.filter((category) => category === NO_VALUE)];
  }, [features, field]);
  const palette = dark ? SERIES_COLORS.dark : SERIES_COLORS.light;
  const colorOf = (category: string) => {
    if (category === NO_VALUE) return dark ? NO_VALUE_COLORS.dark : NO_VALUE_COLORS.light;
    return (field ? palette[categories.indexOf(category)] : palette[0]) ?? palette[0] ?? "#1b7a4f";
  };

  useEffect(() => {
    if (refreshKey > 0) void geojson.refetch();
  }, [refreshKey]);

  useEffect(() => {
    if (geojson.data) setFetchedAt(new Date().toISOString());
  }, [geojson.data]);

  // The map, once; a resize of its box (a tab shown, a window resized) redraws it at its real size.
  useEffect(() => {
    const element = container.current;
    if (!element) return undefined;
    // With reduced motion asked for, zooming and panning jump instead of gliding.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const map = L.map(element, { preferCanvas: true, zoomControl: true, zoomAnimation: !still, fadeAnimation: !still, markerZoomAnimation: !still, inertia: !still }).setView(
      [39.5, -8.0],
      6,
    );
    L.control.scale({ imperial: false }).addTo(map);
    L.tileLayer(OSM, { maxZoom: 19, attribution: ATTRIBUTION, referrerPolicy: "strict-origin-when-cross-origin", crossOrigin: true }).addTo(map);
    const points = new PointLayer().addTo(map);
    mapRef.current = map;
    pointsRef.current = points;

    // Points live on a canvas that ignores the pointer, so the map finds the nearest one itself.
    map.on("click", (event: L.LeafletMouseEvent) => {
      const hit = points.nearest(event.containerPoint, 10);
      const feature = hit ? featuresRef.current[hit.index] : undefined;
      if (hit && feature) L.popup(POPUP).setLatLng([hit.lat, hit.lng]).setContent(popupHtml(feature.properties)).openOn(map);
    });
    let pending = 0;
    map.on("mousemove", (event: L.LeafletMouseEvent) => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        element.style.cursor = points.nearest(event.containerPoint, 10) ? "pointer" : "";
      });
    });

    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(element);
    return () => {
      cancelAnimationFrame(pending);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      pointsRef.current = null;
      areaLayerRef.current = null;
      lastPositions.current.clear();
      fittedRef.current = false;
    };
  }, []);

  // Draw. Points go to the canvas layer, gliding from where they were on the last collection;
  // lines and areas become one GeoJSON layer drawn by Leaflet's canvas renderer.
  useEffect(() => {
    const map = mapRef.current;
    const points = pointsRef.current;
    if (!map || !points) return;
    featuresRef.current = features;
    const colors = new Map(categories.map((category) => [category, colorOf(category)]));
    colors.set("all", colorOf("all"));

    const plotted: Plotted[] = [];
    const outlines: GeoJSON.Feature[] = [];
    const previous = lastPositions.current;
    const next = new Map<string, [number, number]>();
    let moved = false;
    let south = 90;
    let west = 180;
    let north = -90;
    let east = -180;
    features.forEach((feature, index) => {
      const category = categoryOf(feature);
      const positions = pointsOf(feature);
      if (positions) {
        positions.forEach((position, part) => {
          const [lat, lng] = position;
          const id = `${String(feature.id ?? index)}#${part}`;
          const [fromLat, fromLng] = previous.get(id) ?? position;
          if (fromLat !== lat || fromLng !== lng) moved = true;
          next.set(id, position);
          plotted.push({ index, lat, lng, fromLat, fromLng, category });
          south = Math.min(south, lat);
          north = Math.max(north, lat);
          west = Math.min(west, lng);
          east = Math.max(east, lng);
        });
        return;
      }
      const geometry = toGeoJson(feature.geometry);
      if (geometry && !hidden.has(category)) outlines.push({ type: "Feature", geometry, properties: { index } });
    });
    lastPositions.current = next;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    points.update(plotted, { colors, hidden, outline: dark ? "#111" : "#fff", animate: moved && plotted.length <= GLIDE_LIMIT && !reducedMotion });

    areaLayerRef.current?.remove();
    areaLayerRef.current = null;
    if (outlines.length) {
      const colorAt = (index: number) => {
        const feature = features[index];
        return colorOf(feature ? categoryOf(feature) : "all");
      };
      const areaLayer = L.geoJSON(outlines, {
        style: (outline) => outlineStyle(colorAt(Number(outline?.properties?.index))),
        // A point inside a collection of other shapes is drawn as a dot: Leaflet's default is a marker image this build does not ship.
        pointToLayer: (outline: GeoJSON.Feature, at) => L.circleMarker(at, { ...outlineStyle(colorAt(Number(outline.properties?.index))), radius: 4, fillOpacity: 0.8 }),
        bubblingMouseEvents: false,
      });
      areaLayer.on("click", (event: L.LeafletMouseEvent) => {
        const feature = features[Number(event.propagatedFrom?.feature?.properties?.index)];
        if (feature) L.popup(POPUP).setLatLng(event.latlng).setContent(popupHtml(feature.properties)).openOn(map);
      });
      areaLayer.on("mouseover", (event: L.LeafletMouseEvent) => event.propagatedFrom?.setStyle?.({ weight: 4, opacity: 1, fillOpacity: 0.3 }));
      areaLayer.on("mouseout", (event: L.LeafletMouseEvent) => areaLayer.resetStyle(event.propagatedFrom));
      areaLayer.addTo(map);
      areaLayerRef.current = areaLayer;
    }

    let bounds = plotted.length ? L.latLngBounds([south, west], [north, east]) : null;
    const outlineBounds = areaLayerRef.current?.getBounds();
    if (outlineBounds?.isValid()) bounds = bounds ? bounds.extend(outlineBounds) : outlineBounds;
    if (!bounds?.isValid()) return;
    boundsRef.current = bounds;
    if (!fittedRef.current) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 17, animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches });
      fittedRef.current = true;
    }
  }, [features, field, dark, hidden]);

  const outlines = features.filter((feature) => !isPoints(feature)).length;
  const newest = features.reduce((latest, feature) => {
    const time = feature.properties._time;
    const event = time && isRecord(time) ? time.event : undefined;
    return isText(event) && event > latest ? event : latest;
  }, "");
  const noun = outlines === features.length && outlines > 0 ? "shapes" : outlines > 0 ? "features" : "points";

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-kumo-subtle">
          {geojson.loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader size="sm" /> Loading the map{product.rowCount > 5000 ? `: ${fmt.int(product.rowCount)} records, this can take a few seconds` : ""}…
            </span>
          ) : (
            <>
              {fmt.int(features.length)} {noun} · fetched <RelativeTime value={fetchedAt} />
              {newest ? (
                <>
                  {" "}
                  · positions as of <RelativeTime value={newest} />
                </>
              ) : null}
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {choices.length ? (
            <Select
              aria-label="Colour by"
              className="w-52"
              value={field}
              onValueChange={(value: string | null) => {
                setColourBy(value ?? "");
                setHidden(new Set());
              }}
              items={Object.fromEntries([
                ["", "No colours"],
                ...choices.map((choice) => [choice.name, `Colour by ${humanize(choice.name).replace(/ ID$/, "").toLocaleLowerCase()}`]),
              ])}
            />
          ) : null}
          <Button
            variant="secondary"
            icon={<CrosshairIcon />}
            onClick={() =>
              boundsRef.current?.isValid() &&
              mapRef.current?.fitBounds(boundsRef.current, { padding: [24, 24], maxZoom: 17, animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches })
            }
          >
            Fit to data
          </Button>
        </div>
      </div>

      {field && categories.length > 1 ? (
        <div role="group" aria-label="Categories on the map" className="flex flex-wrap gap-1.5">
          {categories.map((category) => {
            const on = !hidden.has(category);
            return (
              <button
                key={category}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setHidden((current) => {
                    const next = new Set(current);
                    if (next.has(category)) next.delete(category);
                    else next.add(category);
                    return next;
                  })
                }
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs ring-1 ring-kumo-line ${on ? "bg-kumo-base text-kumo-default" : "bg-kumo-recessed text-kumo-subtle line-through"}`}
              >
                <span className={`size-2.5 rounded-full ${on ? "" : "opacity-40"}`} style={{ background: colorOf(category) }} aria-hidden="true" />
                {categoryLabel(category)}
              </button>
            );
          })}
        </div>
      ) : null}

      <ErrorNote error={geojson.error} what="the map" onRetry={() => void geojson.refetch()} />
      <div
        ref={container}
        role="region"
        aria-label={`${product.title} on a map`}
        className="h-[min(70vh,36rem)] min-h-80 w-full overflow-hidden rounded-xl ring-1 ring-kumo-line"
      />
      <p className="text-xs text-kumo-subtle">
        Shapes come straight from the current records. Select one for its details, switch a category off in the legend, or open the Records tab for the same rows as text.
      </p>
    </div>
  );
}
