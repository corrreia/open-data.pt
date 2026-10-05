import { Badge, Button, ClipboardText, LayerCard, Link } from "@cloudflare/kumo";
import { CommandBlock } from "../ops/CommandBlock";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { productPath } from "../../lib/api";
import type { Product } from "../../lib/types";
import { API_VIEW } from "../../text/product";

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
  const list: Endpoint[] = [{ title: API_VIEW.metadata, path: base, description: API_VIEW.metadataText }];
  if (product.role === "time-series") {
    list.push(
      { title: API_VIEW.currentPoints, path: `${base}/series?limit=500`, description: API_VIEW.currentPointsText },
      {
        title: API_VIEW.history,
        path: `${base}/series/range?${dataSpan}&limit=500`,
        description: API_VIEW.historyText,
      },
      {
        title: API_VIEW.knownThen,
        path: `${base}/series/range?${dataSpan}&knownAt=${knownAt}&limit=500`,
        description: API_VIEW.knownThenText,
      },
      { title: API_VIEW.recentCorrections, path: `${base}/series/changes?limit=200`, description: API_VIEW.recentCorrectionsText },
      { title: API_VIEW.windowCorrections, path: `${base}/series/changes/range?${changeSpan}&limit=500`, description: API_VIEW.windowCorrectionsText },
    );
  } else {
    list.push({ title: API_VIEW.currentRecords, path: `${base}/records?limit=50`, description: API_VIEW.currentRecordsText });
    const filterable = product.schema.fields.find((field) => ["category", "identifier", "string"].includes(field.type));
    if (filterable)
      list.push({
        title: API_VIEW.filteredRecords,
        path: `${base}/records?where=${encodeURIComponent(filterable.id)}:VALUE&limit=50`,
        template: true,
        description: API_VIEW.filteredRecordsText(filterable.name),
      });
    if (product.schema.fields.some((field) => field.type === "geometry" || field.type === "latitude")) {
      list.push(
        {
          title: API_VIEW.inArea,
          path: `${base}/records?bbox=MIN_LON,MIN_LAT,MAX_LON,MAX_LAT&limit=50`,
          template: true,
          description: API_VIEW.inAreaText,
        },
        { title: "GeoJSON", path: `${base}.geojson`, description: API_VIEW.geojsonText },
      );
    }
    if (product.role === "event-log") {
      list.push(
        { title: API_VIEW.eventHistory, path: `${base}/events?${dataSpan}&limit=200`, description: API_VIEW.eventHistoryText },
        { title: API_VIEW.eventsThen, path: `${base}/events?${dataSpan}&knownAt=${knownAt}&limit=200`, description: API_VIEW.eventsThenText },
      );
    }
    if (product.hasChanges) {
      list.push(
        { title: API_VIEW.recentChanges, path: `${base}/changes?limit=200`, description: API_VIEW.recentChangesText },
        { title: API_VIEW.windowChanges, path: `${base}/changes/range?${changeSpan}&limit=500`, description: API_VIEW.windowChangesText },
      );
    }
  }
  list.push({ title: API_VIEW.dcat, path: "/api/catalog.dcat.json", description: API_VIEW.dcatText });
  return list;
}

/** Copyable, keyless endpoints for this product. */
export default function ApiView({ product }: { product: Product }) {
  const endpoints = endpointsFor(product);
  const absolute = (path: string) => new URL(path, window.location.origin).toString();
  const example = endpoints[1] ?? endpoints[0];
  return (
    <div className="grid gap-5">
      <p className="text-sm text-kumo-subtle">{API_VIEW.intro}</p>
      <div className="grid gap-3">
        {endpoints.map((endpoint) => (
          <LayerCard key={endpoint.title}>
            <LayerCard.Secondary className="flex items-center justify-between gap-3">
              <span className="font-medium text-kumo-default">{endpoint.title}</span>
              {endpoint.template ? (
                <Badge variant="outline">{API_VIEW.template}</Badge>
              ) : (
                <Button size="sm" variant="ghost" icon={<ArrowSquareOutIcon />} onClick={() => window.open(endpoint.path, "_blank", "noopener")}>
                  {API_VIEW.open}
                </Button>
              )}
            </LayerCard.Secondary>
            <LayerCard.Primary className="grid gap-2">
              <ClipboardText text={absolute(endpoint.path)} size="sm" className="min-w-0" labels={{ copyAction: API_VIEW.copyAction }} />
              <p className="text-xs text-kumo-subtle">{endpoint.description}</p>
            </LayerCard.Primary>
          </LayerCard>
        ))}
      </div>
      {example ? (
        <div className="grid gap-2">
          <p className="text-sm text-kumo-subtle">{API_VIEW.fromTerminal}</p>
          <CommandBlock command={`curl -s '${absolute(example.path)}'`} label={API_VIEW.exampleRequest} />
        </div>
      ) : null}
      <p className="text-sm">
        <Link href="/docs#tag/products">{API_VIEW.reference}</Link>
      </p>
    </div>
  );
}
