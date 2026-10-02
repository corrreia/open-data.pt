import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonValue } from "../src/lib/types";
import { registerSiteTools } from "../src/lib/webmcp";

interface Registered {
  name: string;
  execute: (input: Record<string, never>) => Promise<JsonValue>;
}

/** A model context that keeps what the page registers on it. */
function modelContext() {
  const tools: Registered[] = [];
  return { tools, context: { registerTool: async (tool: Registered) => void tools.push(tool) } };
}

afterEach(() => vi.unstubAllGlobals());

describe("WebMCP tools", () => {
  it.each([
    { where: "the document, as the September 2026 draft has it", document: true },
    { where: "the navigator, where browsers on earlier drafts put it", document: false },
  ])("are registered on $where", ({ document }) => {
    const { tools, context } = modelContext();
    vi.stubGlobal("document", document ? { modelContext: context } : {});
    vi.stubGlobal("navigator", document ? {} : { modelContext: context });
    registerSiteTools();
    expect(tools.map((tool) => tool.name)).toEqual(["search_datasets", "get_product", "read_rows", "open_product"]);
  });

  it("read the catalog once for an agent searching several times in a row", async () => {
    const { tools, context } = modelContext();
    vi.stubGlobal("document", { modelContext: context });
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", { location: { origin: "https://open-data.pt" } });
    const read: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        read.push(path);
        return Response.json({ data: [] });
      }),
    );
    registerSiteTools();
    const search = tools.find((tool) => tool.name === "search_datasets");
    if (!search) throw new Error("search_datasets was not registered");
    for (let time = 0; time < 3; time += 1) await search.execute({});
    // The products and feeds lists are a few megabytes together.
    expect(read.sort()).toEqual(["/api/feeds", "/api/products"]);
  });
});
