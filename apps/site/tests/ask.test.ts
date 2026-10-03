import { describe, expect, it } from "vitest";
import { readReply } from "../src/lib/ask";

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
    expect(reply).toMatchObject({ content: "", finishReason: "tool_calls", neurons: 3 });
  });

  it("shows the answer as it grows", async () => {
    const seen: string[] = [];
    const pieces = ["Hoje, ", "2,30 €."].map((content) => JSON.stringify({ choices: [{ delta: { content } }] }));
    const reply = await readReply(eventStream(pieces, 5), (text) => seen.push(text));
    expect(seen).toEqual(["Hoje, ", "Hoje, 2,30 €."]);
    expect(reply.content).toBe("Hoje, 2,30 €.");
  });
});
