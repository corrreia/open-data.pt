import type { PublisherDefinition } from "#/catalog/define";

export const PUBLISHER: PublisherDefinition = {
  name: "RIPE NCC",
  url: "https://www.ripe.net/",
  sources: [{ host: "stat.ripe.net", query: { sourceapp: "open-data.pt" } }, "atlas.ripe.net"],
  logo: "svg",
  // RIPEstat is read with RIPE NCC's permission, and with the `sourceapp` they asked for; RIPE Atlas is still
  // held, on its dataset. See docs/publishers/ripe-ncc.md.
};
