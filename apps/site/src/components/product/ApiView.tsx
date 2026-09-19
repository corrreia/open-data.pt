import { Badge, Button, ClipboardText, LayerCard, Link } from "@cloudflare/kumo";
import { CommandBlock } from "../ops/CommandBlock";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { productPath } from "../../lib/api";
import type { Product } from "../../lib/types";

interface Endpoint {
  title: string;
  path: string;
  description: string;
  /** Has placeholders to fill in: copied, never opened. */
  template?: boolean;
}

function endpointsFor(product: Product): Endpoint[] {
  const base = productPath(product.slug);
  // Example windows that return rows: data windows end at the product's newest data; change windows are knowledge time.
  const iso = (date: Date) => encodeURIComponent(date.toISOString().replace(/\.\d{3}Z$/, "Z"));
  const newest = product.watermark ? new Date(product.watermark) : new Date();
  const dataSpan = `from=${iso(new Date(newest.getTime() - 30 * 86_400_000))}&to=${iso(newest)}`;
  const changeSpan = `from=${iso(new Date(Date.now() - 7 * 86_400_000))}&to=${iso(new Date())}`;
  const knownAt = iso(new Date(Date.now() - 86_400_000));
  const list: Endpoint[] = [{ title: "Product metadata", path: base, description: "Schema, version, freshness, cadence, licence and attribution." }];
  if (product.role === "time-series") {
    list.push(
      { title: "Current points", path: `${base}/series?limit=500`, description: "The newest points, newest first. Filter with seriesKey, from and to." },
      {
        title: "History",
        path: `${base}/series/range?${dataSpan}&limit=500`,
        description: "Every point of a past window from the durable history. Windows span up to 366 days; page with the returned cursor.",
      },
      {
        title: "As known then",
        path: `${base}/series/range?${dataSpan}&knownAt=${knownAt}&limit=500`,
        description: "The same window as it had been published at knownAt: later corrections are left out.",
      },
      { title: "Recent corrections", path: `${base}/series/changes?limit=200`, description: "Points revised after they were first published." },
      { title: "Corrections in a window", path: `${base}/series/changes/range?${changeSpan}&limit=500`, description: "Every new or corrected point ingested in a past window." },
    );
  } else {
    list.push({ title: "Current records", path: `${base}/records?limit=50`, description: "The current rows, paged with a cursor." });
    const filterable = product.schema.fields.find((field) => ["category", "identifier", "string"].includes(field.type));
    if (filterable)
      list.push({
        title: "Filtered records",
        path: `${base}/records?where=${encodeURIComponent(filterable.id)}:VALUE&limit=50`,
        template: true,
        description: `Rows whose ${filterable.name} equals VALUE. Repeat where= for up to five fields.`,
      });
    if (product.schema.fields.some((field) => field.type === "geometry" || field.type === "latitude")) {
      list.push(
        {
          title: "Records in an area",
          path: `${base}/records?bbox=MIN_LON,MIN_LAT,MAX_LON,MAX_LAT&limit=50`,
          template: true,
          description: "Rows inside a bounding box, in degrees.",
        },
        { title: "GeoJSON", path: `${base}.geojson`, description: "The current rows as a GeoJSON FeatureCollection." },
      );
    }
    if (product.role === "event-log") {
      list.push(
        { title: "Event history", path: `${base}/events?${dataSpan}&limit=200`, description: "Events of a past window from the durable history, up to 366 days." },
        { title: "Events as known then", path: `${base}/events?${dataSpan}&knownAt=${knownAt}&limit=200`, description: "The same window as it had been published at knownAt." },
      );
    }
    if (product.hasChanges) {
      list.push(
        { title: "Recent changes", path: `${base}/changes?limit=200`, description: "Creates, updates, corrections and retractions from the recent window." },
        { title: "Changes in a window", path: `${base}/changes/range?${changeSpan}&limit=500`, description: "Every revision ingested in a past window." },
      );
    }
  }
  list.push({ title: "DCAT catalog", path: "/api/catalog.dcat.json", description: "This product’s dataset entry in the JSON-LD catalog." });
  return list;
}

/** Copyable, keyless endpoints for this product. */
export default function ApiView({ product }: { product: Product }) {
  const endpoints = endpointsFor(product);
  const absolute = (path: string) => new URL(path, window.location.origin).toString();
  const example = endpoints[1] ?? endpoints[0];
  return (
    <div className="grid gap-5">
      <p className="text-sm text-kumo-subtle">
        Open, read-only and keyless. Responses are JSON with CORS enabled; errors use application/problem+json. Requests are rate limited per client and a 429 says when to retry.
      </p>
      <div className="grid gap-3">
        {endpoints.map((endpoint) => (
          <LayerCard key={endpoint.title}>
            <LayerCard.Secondary className="flex items-center justify-between gap-3">
              <span className="font-medium text-kumo-default">{endpoint.title}</span>
              {endpoint.template ? (
                <Badge variant="outline">template</Badge>
              ) : (
                <Button size="sm" variant="ghost" icon={<ArrowSquareOutIcon />} onClick={() => window.open(endpoint.path, "_blank", "noopener")}>
                  Open
                </Button>
              )}
            </LayerCard.Secondary>
            <LayerCard.Primary className="grid gap-2">
              <ClipboardText text={absolute(endpoint.path)} size="sm" className="min-w-0" />
              <p className="text-xs text-kumo-subtle">{endpoint.description}</p>
            </LayerCard.Primary>
          </LayerCard>
        ))}
      </div>
      {example ? (
        <div className="grid gap-2">
          <p className="text-sm text-kumo-subtle">From a terminal:</p>
          <CommandBlock command={`curl -s '${absolute(example.path)}'`} label="Example request" />
        </div>
      ) : null}
      <p className="text-sm">
        <Link href="/docs#tag/products">Open the API reference</Link>
      </p>
    </div>
  );
}
