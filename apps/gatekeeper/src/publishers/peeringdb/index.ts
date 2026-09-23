import type { PublisherDefinition } from "#/catalog/define";

export const PUBLISHER: PublisherDefinition = {
  name: "PeeringDB",
  url: "https://www.peeringdb.com/",
  sources: ["www.peeringdb.com"],
  logo: "png",
  // Held: PeeringDB's acceptable-use policy requires permission for reproduction and bulk sharing outside its
  // approved operational uses. Asked, awaiting an answer. https://www.peeringdb.com/aup
  enabled: false,
};
