import { describe, expect, it } from "vitest";
import { datasetsRead, readReply } from "../src/lib/ask";

/** A Chat Completions event stream, cut into pieces at awkward places, as the network delivers it. */
function eventStream(events: string[], cutEvery = 7) {
  const text = events.map((event) => `data: ${event}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < bytes.length; at += cutEvery) controller.enqueue(bytes.slice(at, at + cutEvery));
      controller.close();
    },
  });
}

describe("a model's streamed reply", () => {
  it("puts each tool call back together from the pieces that arrive under its index", async () => {
    const pieces = [
      JSON.stringify({ choices: [{ delta: { reasoning_content: "Let me look." } }], usage: { neurons: 2.5 } }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "search_datasets", arguments: '{"que' } }] } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 1, id: "call_b", function: { name: "get_product", arguments: '{"slug":' } }] } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"sismos"}' } }] } }], usage: { neurons: 0.5 } }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '"ipma-earthquakes"}' } }] }, finish_reason: "tool_calls" }] }),
      "[DONE]",
    ];
    const reply = await readReply(eventStream(pieces), () => {});
    expect(reply.toolCalls).toEqual([
      { id: "call_a", type: "function", function: { name: "search_datasets", arguments: '{"query":"sismos"}' } },
      { id: "call_b", type: "function", function: { name: "get_product", arguments: '{"slug":"ipma-earthquakes"}' } },
    ]);
    expect(reply).toMatchObject({ content: "", reasoning: "Let me look.", finishReason: "tool_calls", neurons: 3 });
  });

  it("shows the answer as it grows", async () => {
    const seen: string[] = [];
    const pieces = ["Hoje, ", "2,30 €."].map((content) => JSON.stringify({ choices: [{ delta: { content } }] }));
    const reply = await readReply(eventStream(pieces, 5), (sofar) => seen.push(sofar.content));
    expect(seen).toEqual(["Hoje, ", "Hoje, 2,30 €."]);
    expect(reply.content).toBe("Hoje, 2,30 €.");
  });

  it("keeps a Copilot model's thinking apart from its answer, and counts the tokens its last event reports", async () => {
    const pieces = [
      JSON.stringify({ choices: [{ delta: { reasoning_text: "Fuel prices are DGEG's." } }] }),
      JSON.stringify({ choices: [{ delta: { content: "1,62 €" }, finish_reason: "stop" }] }),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 } }),
    ];
    const reply = await readReply(eventStream(pieces), () => {});
    expect(reply).toMatchObject({ content: "1,62 €", reasoning: "Fuel prices are DGEG's.", tokens: 940, neurons: 0 });
  });
});

describe("the datasets an answer read", () => {
  it("names each product its code reads once, by slug, in the order it first reads them", () => {
    const code = `const a = await codemode.request({ method: "GET", path: "/api/products/dgeg-fuel-prices/records" });
const b = await codemode.request({ method: "GET", path: \`/api/products/ipma-earthquakes\` });
const c = await codemode.request({ method: "GET", path: "/api/products/dgeg-fuel-prices" });
const d = await codemode.request({ method: "GET", path: "/api/products" });`;
    expect(datasetsRead(code)).toEqual(["dgeg-fuel-prices", "ipma-earthquakes"]);
  });
});
