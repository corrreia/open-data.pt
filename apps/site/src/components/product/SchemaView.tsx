import { Badge, LayerCard, Table } from "@cloudflare/kumo";
import type { Product } from "../../lib/types";

/** The canonical schema the transformer wrote for this version. */
export function SchemaView({ product }: { product: Product }) {
  return (
    <div className="grid gap-3">
      <p className="text-sm text-kumo-subtle">
        The schema written for version {product.version}. Every record also carries a <code>_time</code> object with its event, validity, source-published, observed and ingested clocks.
      </p>
      <LayerCard className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table aria-label="Schema">
            <Table.Header>
              <Table.Row>
                <Table.Head>Field</Table.Head>
                <Table.Head>Type</Table.Head>
                <Table.Head>Nullable</Table.Head>
                <Table.Head>Unit</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {product.schema.fields.map((field) => (
                <Table.Row key={field.name}>
                  <Table.Cell>
                    <code className="font-mono text-[0.8rem]">{field.name}</code>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge variant="outline">{field.type}</Badge>
                  </Table.Cell>
                  <Table.Cell>{field.nullable ? "yes" : "no"}</Table.Cell>
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
