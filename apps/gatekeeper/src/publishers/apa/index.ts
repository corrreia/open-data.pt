import type { PublisherDefinition } from "#/catalog/define";

export const PUBLISHER: PublisherDefinition = {
  name: "APA · Agência Portuguesa do Ambiente",
  url: "https://apambiente.pt/",
  sources: [
    "infoagua.apambiente.pt",
    "sniambgeoogc.apambiente.pt",
    // One export of 50 stations takes this PHP site up to 15 seconds, and our history walk once had it answering
    // us nonstop until APA blocked us (docs/publishers/apa.md): no more than one request every five seconds.
    { host: "snirh.apambiente.pt", minIntervalSeconds: 5 },
  ],
  logo: "png",
};
