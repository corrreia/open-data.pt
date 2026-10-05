import { Badge, LayerCard, Table } from "@cloudflare/kumo";
import type { Product } from "../../lib/types";
import { SCHEMA } from "../../text/product";

/** The canonical schema the transformer wrote for this version. */
export function SchemaView({ product }: { product: Product }) {
  return (
    <div className="grid gap-3">
      <p className="text-sm text-kumo-subtle">
        {SCHEMA.intro(product.version)} <code>_time</code> {SCHEMA.clocks}
      </p>
      <LayerCard className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table aria-label={SCHEMA.label}>
            <Table.Header>
              <Table.Row>
                <Table.Head>{SCHEMA.field}</Table.Head>
                <Table.Head>{SCHEMA.type}</Table.Head>
                <Table.Head>{SCHEMA.nullable}</Table.Head>
                <Table.Head>{SCHEMA.unit}</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {product.schema.fields.map((field) => (
                <Table.Row key={field.name}>
                  <Table.Cell>
                    <code className="font-mono text-sm">{field.name}</code>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge variant="outline">{field.type}</Badge>
                  </Table.Cell>
                  <Table.Cell>{field.nullable ? SCHEMA.yes : SCHEMA.no}</Table.Cell>
                  <Table.Cell className="text-kumo-subtle">{field.unit ?? "—"}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      </LayerCard>
    </div>
  );
}
