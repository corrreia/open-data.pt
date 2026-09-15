import { field, streamCsvRows } from "../../../index";
import type {
  NormalizedRow,
  ProductDeclaration,
  ProductFinalization,
  StreamingTransform,
  TransformContext,
} from "../../../index";
import { isUtf8, peekBody } from "./body";
import type { Transformer } from "./transformer";

/** Bytes read to choose between UTF-8 and Windows-1252 before the rows stream. */
const PREFIX_BYTES = 64 * 1024;
const TOTALS_KEY = "municipal-waste-totals";
const SERIES_KEY = "municipal-waste-series";

const PRODUCTS: ProductDeclaration[] = [
  {
    productKey: TOTALS_KEY,
    slug: "cadaval-municipal-waste",
    title: "Cadaval municipal waste totals",
    description: "Annual waste totals by material and collection route published by Município do Cadaval.",
    role: "reference",
    kind: "record",
    schema: {
      fields: [
        field("material", "category", false),
        field("collection", "category", false),
        field("year", "number", false, "year"),
        field("annualTotal", "number", false, "tonne"),
      ],
    },
    updateMode: "authoritative-snapshot",
    completeness: "complete",
  },
  {
    productKey: SERIES_KEY,
    slug: "cadaval-municipal-waste-series",
    title: "Cadaval municipal waste by month",
    description: "Monthly tonnes of waste by material and collection route in Cadaval.",
    role: "time-series",
    kind: "series",
    schema: {
      fields: [
        field("seriesKey", "string", false),
        field("eventTime", "datetime", false),
        field("value", "number", false, "tonne"),
        field("dimensions", "json", false),
      ],
    },
    updateMode: "delta",
    completeness: "complete",
  },
];

/** Fixed-schema translator for the Cadaval municipal waste workbook exported as CSV, one row at a time. */
export class MunicipalWasteTransformer implements Transformer {
  readonly id = "cadaval-municipal-waste-v1";
  readonly version = "2";

  async transform(body: ReadableStream<Uint8Array>, _context: TransformContext): Promise<StreamingTransform> {
    const peeked = await peekBody(body, PREFIX_BYTES);
    const utf8 = isUtf8(peeked.prefix, peeked.complete);
    const csv = streamCsvRows(peeked.body, { delimiter: ";", encoding: utf8 ? "utf-8" : "latin1" });
    let accepted = 0;
    let yearRows = 0;
    let recordWatermark: string | undefined;
    let pointWatermark: string | undefined;

    async function* rows(): AsyncGenerator<NormalizedRow> {
      let index = 0;
      let material: string | undefined;
      for await (const raw of csv) {
        index += 1;
        const row = raw.map((cell) => cell.trim());
        const materialCell = row[1];
        if (/^\d{4}$/.test(materialCell ?? "")) yearRows += 1;
        if (index <= 3) continue;
        if (materialCell && !/^\d{4}$/.test(materialCell) && !materialCell.startsWith("Capitação") && materialCell !== "Destino (%)") {
          material = materialCell;
          continue;
        }
        if (!material || !/^\d{4}$/.test(materialCell ?? "")) continue;
        const currentMaterial = material;
        const year = Number(materialCell);
        const collection = row[2] || "Total";
        const monthly = row.slice(3, 15).map(decimal);
        const annualTotal = decimal(row[15]);
        if (monthly.every((value) => value === null) || annualTotal === null) continue;

        const eventTime = `${year}-12-31T00:00:00.000Z`;
        accepted += 1;
        if (recordWatermark === undefined || eventTime > recordWatermark) recordWatermark = eventTime;
        yield {
          productKey: TOTALS_KEY,
          record: {
            entityKey: `${year}:${currentMaterial}:${collection}`,
            eventTime,
            payload: { material: currentMaterial, collection, year, annualTotal },
          },
        };
        for (const [monthIndex, value] of monthly.entries()) {
          if (value === null) continue;
          const pointTime = `${year}-${String(monthIndex + 1).padStart(2, "0")}-01T00:00:00.000Z`;
          if (pointWatermark === undefined || pointTime > pointWatermark) pointWatermark = pointTime;
          yield {
            productKey: SERIES_KEY,
            point: {
              seriesKey: `${slug(currentMaterial)}:${slug(collection)}`,
              eventTime: pointTime,
              value,
              unit: "tonne",
              dimensions: { material: currentMaterial, collection },
            },
          };
        }
      }
    }

    return {
      products: PRODUCTS,
      rows: rows(),
      finish: () => {
        const rejected = Math.max(0, yearRows - accepted);
        const products: ProductFinalization[] = [];
        if (recordWatermark !== undefined) products.push({ productKey: TOTALS_KEY, watermark: recordWatermark });
        if (pointWatermark !== undefined) products.push({ productKey: SERIES_KEY, watermark: pointWatermark });
        return {
          quality: {
            acceptedRecords: accepted,
            rejectedRecords: rejected,
          },
          products,
        };
      },
    };
  }
}

function decimal(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/[\u00A0\s.]/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

