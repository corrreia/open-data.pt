import { field, streamCsvRecords } from "../../index";
import type { NormalizedRow, ProductDeclaration, StreamingTransform, TransformContext } from "../../index";
import type { StreamingTransformer } from "../../index";

const PRODUCT_KEY = "municipal-accessibility";

const PRODUCT: ProductDeclaration = {
  productKey: PRODUCT_KEY,
  slug: "municipal-accessibility",
  title: "Municipal digital accessibility",
  description: "Clean accessibility measurements for Portuguese municipalities.",
  role: "reference",
  kind: "record",
  schema: {
    fields: [
      field("municipality", "string", false),
      field("accessibilityScore", "number", true, "score"),
      field("pagesEvaluated", "number", true, "page"),
      field("aaCompliantPages", "number", true, "page"),
      field("declarationStatus", "category", true),
      field("accessibilitySeal", "category", true),
      field("websiteCount", "number", true, "website"),
    ],
  },
  updateMode: "authoritative-snapshot",
  completeness: "complete",
};

export class MunicipalAccessibilityTransformer implements StreamingTransformer {
  readonly id = "municipal-accessibility-v1";
  readonly version = "3";

  async transform(body: ReadableStream<Uint8Array>, _context: TransformContext): Promise<StreamingTransform> {
    const csv = streamCsvRecords(body);
    let accepted = 0;
    let rejected = 0;
    async function* rows(): AsyncGenerator<NormalizedRow> {
      for await (const row of csv.records) {
        const municipality = cleanMunicipality(row.entidade);
        if (!municipality) {
          rejected += 1;
          continue;
        }
        accepted += 1;
        yield {
          productKey: PRODUCT_KEY,
          record: {
            entityKey: municipality,
            payload: {
              municipality,
              accessibilityScore: decimal(row.pontuacao_observatorio),
              pagesEvaluated: integer(row.paginas_avaliadas),
              aaCompliantPages: integer(row.paginas_conformes_aa),
              declarationStatus: normalizeLabel(row.declaracao),
              accessibilitySeal: normalizeLabel(row.selo),
              websiteCount: integer(row.n_sites),
            },
          },
        };
      }
    }
    return {
      products: [PRODUCT],
      rows: rows(),
      finish: () => ({
        quality: {
          acceptedRecords: accepted,
          rejectedRecords: rejected,
        },
      }),
    };
  }
}

function cleanMunicipality(value: string | undefined): string | null {
  if (!value) return null;
  return value.replace(/^Câmara Municipal (?:da |de |do |dos |das )?/i, "").trim() || null;
}

function decimal(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLabel(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}
