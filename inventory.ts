import { OGC_EXAMPLES } from "./packages/gatekeeper-shared/src/formats/ogc/examples";
import { STAC_EXAMPLES } from "./packages/gatekeeper-shared/src/formats/stac/examples";
import { SNIT_EXAMPLES } from "./packages/gatekeeper-shared/src/sources/snit/examples";

const all = [...OGC_EXAMPLES, ...STAC_EXAMPLES, ...SNIT_EXAMPLES].filter((e) => e.publisher === "dgt");
console.log(`${all.length} DGT feeds\n`);
for (const e of all) {
  const c = e.policy.collection;
  console.log(
    [
      e.slug.padEnd(52),
      String(e.config.geometry ?? "-").padEnd(8),
      `${(c.maxBytes / 1048576).toFixed(0)}MiB`.padStart(8),
      `${c.timeoutSeconds}s`.padStart(6),
      `${(c.cadenceSeconds / 86400).toFixed(0)}d`.padStart(4),
      (e.topics ?? []).join("+"),
    ].join("  "),
  );
}
