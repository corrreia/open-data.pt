import type { PublisherDefinition } from "#/catalog/define";

export const PUBLISHER: PublisherDefinition = {
  name: "APA · Agência Portuguesa do Ambiente",
  url: "https://apambiente.pt/",
  sources: [
    "infoagua.apambiente.pt",
    "sniambgeoogc.apambiente.pt",
    // One export of 50 stations takes this PHP site up to 15 seconds, and our history walk once had it answering
    // us nonstop until APA blocked our User-Agent (docs/publishers/apa.md): no more than one request every five
    // seconds, under a common browser's name.
    {
      host: "snirh.apambiente.pt",
      minIntervalSeconds: 5,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    },
  ],
  logo: "png",
};
