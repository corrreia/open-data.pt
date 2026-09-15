#!/usr/bin/env bash
# Provision the normalized-history lake in fresh v2 resources. This intentionally
# does not migrate or reuse the retired raw/delta deployment.
#
# Prerequisite: CATALOG_TOKEN with R2 Data Catalog, R2 Storage, and R2 SQL edit/read.
set -euo pipefail

: "${CATALOG_TOKEN:?Set CATALOG_TOKEN (for example: set -a; . ./.env; set +a)}"
DATA_BUCKET="open-data-pt-data"
BUCKET="open-data-pt-history"
NAMESPACE="open_data"
PREFIX="open_data_v2"

buckets="$(pnpm exec wrangler r2 bucket list)"
if ! grep -q "name: *$DATA_BUCKET" <<<"$buckets"; then
  pnpm exec wrangler r2 bucket create "$DATA_BUCKET"
fi
if ! grep -q "name: *$BUCKET" <<<"$buckets"; then
  pnpm exec wrangler r2 bucket create "$BUCKET"
fi
pnpm exec wrangler r2 bucket catalog enable "$BUCKET" >/dev/null 2>&1 || true
# Sinks roll a file every 300 s per table; without compaction a two-month history
# query reads thousands of small files. 128 MB suits streaming ingest.
pnpm exec wrangler r2 bucket catalog compaction enable "$BUCKET" --target-size 128 --token "$CATALOG_TOKEN"

# Only revisions are history. The retired open_data_v2_acquisitions stream, sink and
# pipeline are no longer bound by the kernel and may be deleted by the operator.
for table in records points; do
  stream="${PREFIX}_${table}"
  sink="${PREFIX}_${table}_sink"
  pipeline="${PREFIX}_${table}_pipeline"

  if ! pnpm exec wrangler pipelines streams get "$stream" >/dev/null 2>&1; then
    pnpm exec wrangler pipelines streams create "$stream" \
      --schema-file "infra/lake/${table}.schema.json" \
      --http-enabled false
  fi

  if ! pnpm exec wrangler pipelines sinks get "$sink" >/dev/null 2>&1; then
    pnpm exec wrangler pipelines sinks create "$sink" \
      --type r2-data-catalog \
      --bucket "$BUCKET" \
      --namespace "$NAMESPACE" \
      --table "$table" \
      --catalog-token "$CATALOG_TOKEN" \
      --roll-interval 300 \
      --compression zstd
  fi

  # `pipelines get <name>` does not find an existing pipeline by name, so look it up in the list.
  if ! pnpm exec wrangler pipelines list 2>/dev/null | grep -qw -- "$pipeline"; then
    pnpm exec wrangler pipelines create "$pipeline" \
      --sql "INSERT INTO $sink SELECT * FROM $stream"
  fi
done

if pnpm exec wrangler secret list --config apps/kernel/wrangler.jsonc 2>/dev/null | grep -q '"CATALOG_TOKEN"'; then
  echo "Worker secret CATALOG_TOKEN already set"
else
  printf '%s' "$CATALOG_TOKEN" | pnpm exec wrangler secret put CATALOG_TOKEN --config apps/kernel/wrangler.jsonc
fi

echo "Normalized-history resources are ready. Set kernel pipeline bindings to the open_data_v2 stream IDs before deployment."
