import type { Executor } from "@cloudflare/codemode";
import type { JsonObject } from "@open-data-pt/contract";
import { describe, expect, it } from "vitest";
import { MAX_READ_BYTES, fromHostedAssistant, handleMcp, limitRuns, mcpClientKey, type McpHost } from "../src/mcp";
import { jsonBody } from "./support";

/** Runs sandbox code in the test process: the Dynamic Worker's contract without its isolation. */
const localExecutor: Executor = {
  async execute(code, providers) {
    const namespaces = Array.isArray(providers) ? providers : [{ name: "codemode", fns: providers }];
    try {
      const run = new Function(...namespaces.map((namespace) => namespace.name), `return (${code})();`);
      return { result: await run(...namespaces.map((namespace) => namespace.fns)) };
    } catch (error) {
      return { result: undefined, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

/** A host whose API answers with `answer`, remembering every read. */
function fakeHost(answer: (request: Request) => Response, executor: Executor = localExecutor, clientKey = "203.0.113.7") {
  const seen: Request[] = [];
  const host: McpHost = {
    executor,
    read: async (request) => {
      seen.push(request);
      return answer(request);
    },
    clientKey,
  };
  return { host, seen };
}

function mcpRequest(body: JsonObject): Request {
  return new Request("https://open-data.pt/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "cf-connecting-ip": "203.0.113.7" },
    body: JSON.stringify(body),
  });
}

interface ToolAnswer {
  result: { content: Array<{ type: string; text: string }>; isError?: boolean };
}

async function callTool(host: McpHost, name: "search" | "execute", code: string): Promise<{ text: string; isError: boolean }> {
  const response = await handleMcp(mcpRequest({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: { code } } }), host);
  expect(response.status).toBe(200);
  const body = await jsonBody<ToolAnswer>(response);
  return { text: body.result.content.map((part) => part.text).join("\n"), isError: body.result.isError === true };
}

const products = () =>
  Response.json({
    data: [
      { slug: "precos-combustiveis", role: "current-state" },
      { slug: "consumo-eletricidade", role: "time-series" },
    ],
  });

describe("MCP server", () => {
  it("introduces itself with a session number and offers Code Mode's two tools", async () => {
    const { host } = fakeHost(products);
    const initialize = await handleMcp(
      mcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
      host,
    );
    expect(initialize.status).toBe(200);
    expect(initialize.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(initialize.headers.get("Mcp-Session-Id")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(initialize.headers.get("Access-Control-Expose-Headers")).toBe("Mcp-Session-Id");
    const info = await jsonBody<{ result: { serverInfo: { name: string }; capabilities: { tools?: JsonObject } } }>(initialize);
    expect(info.result.serverInfo.name).toBe("open-data.pt");
    expect(info.result.capabilities.tools).toBeDefined();

    const listedResponse = await handleMcp(mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }), host);
    expect(listedResponse.headers.get("Mcp-Session-Id")).toBeNull();
    const listed = await jsonBody<{ result: { tools: Array<{ name: string; description: string }> } }>(listedResponse);
    expect(listed.result.tools.map((tool) => tool.name).sort()).toEqual(["execute", "search"]);
    const execute = listed.result.tools.find((tool) => tool.name === "execute")?.description ?? "";
    expect(execute).toContain("GET /api/products");
    expect(execute).toContain("cite the licence and attribution");
  });

  it("searches the OpenAPI document in code, without touching the API", async () => {
    const { host, seen } = fakeHost(products);
    const answer = await callTool(host, "search", "async () => Object.keys((await codemode.spec()).paths).filter((path) => path.includes('/series'))");
    expect(answer.isError).toBe(false);
    expect(JSON.parse(answer.text)).toContain("/api/products/{slug}/series/range");
    expect(seen).toHaveLength(0);
  });

  it("reads the API through the kernel's own edge, as the client that asked", async () => {
    const { host, seen } = fakeHost(products);
    const answer = await callTool(
      host,
      "execute",
      `async () => {
      const { data } = await codemode.request({ method: "GET", path: "/api/products" });
      return data.filter((product) => product.role === "time-series").map((product) => product.slug);
    }`,
    );
    expect(answer.isError).toBe(false);
    expect(JSON.parse(answer.text)).toEqual(["consumo-eletricidade"]);
    expect(seen.map((request) => request.url)).toEqual(["https://open-data.pt/api/products"]);
    expect(seen[0]?.method).toBe("GET");
    expect(seen[0]?.headers.get("cf-connecting-ip")).toBe("203.0.113.7");
  });

  it("counts a hosted assistant's callers by session and everyone else by address, over IPv4 and IPv6", () => {
    const session = "4f9c2b1e-8a3d-4c5e-9f1a-2b3c4d5e6f70";
    const caller = (address: string, id?: string) =>
      new Request("https://open-data.pt/mcp", { method: "POST", headers: id ? { "cf-connecting-ip": address, "Mcp-Session-Id": id } : { "cf-connecting-ip": address } });
    for (const address of ["160.79.104.0", "160.79.111.255", "2607:6bc0::1", "2607:6BC0:0:ffff::abcd"]) {
      expect(fromHostedAssistant(address)).toBe(true);
      expect(mcpClientKey(caller(address, session))).toBe(`mcp-session:${session}`);
      expect(mcpClientKey(caller(address))).toBe(address);
    }
    for (const address of ["160.79.103.255", "160.79.112.0", "2607:6bc1::1", "203.0.113.7", "::1", "not-an-address"]) {
      expect(fromHostedAssistant(address)).toBe(false);
      expect(mcpClientKey(caller(address, session))).toBe(address);
    }
    expect(mcpClientKey(caller("160.79.104.9", "made-up"))).toBe("160.79.104.9");
  });

  it("reads the API under the caller's rate-limit key", async () => {
    const { host, seen } = fakeHost(products, localExecutor, "mcp-session:4f9c2b1e-8a3d-4c5e-9f1a-2b3c4d5e6f70");
    await callTool(host, "execute", `async () => codemode.request({ method: "GET", path: "/api/products" })`);
    expect(seen[0]?.headers.get("cf-connecting-ip")).toBe("mcp-session:4f9c2b1e-8a3d-4c5e-9f1a-2b3c4d5e6f70");
  });

  it("repeats array query values, so several where filters all apply", async () => {
    const { host, seen } = fakeHost(() => Response.json({ data: [] }));
    await callTool(
      host,
      "execute",
      `async () => codemode.request({ method: "GET", path: "/api/products/paragens/records", query: { where: ["line:1", "status:open"], limit: 10, cursor: undefined } })`,
    );
    const url = new URL(seen[0]?.url ?? "");
    expect(url.pathname).toBe("/api/products/paragens/records");
    expect(url.searchParams.getAll("where")).toEqual(["line:1", "status:open"]);
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.has("cursor")).toBe(false);
  });

  it("refuses writes and anything outside the API before reading", async () => {
    const { host, seen } = fakeHost(products);
    const attempts = [
      `{ method: "POST", path: "/api/products" }`,
      `{ method: "GET", path: "https://example.com/api/products" }`,
      `{ method: "GET", path: "//example.com/api/products" }`,
      `{ method: "GET", path: "/api/../mcp" }`,
      `{ method: "GET", path: "/openapi.json" }`,
    ];
    for (const attempt of attempts) {
      const answer = await callTool(host, "execute", `async () => { try { await codemode.request(${attempt}); return "read"; } catch (error) { return error.message; } }`);
      expect(answer.text).toMatch(/read-only|Only paths under \/api/);
    }
    expect(seen).toHaveLength(0);
  });

  it("hands API errors to the code as exceptions it can catch", async () => {
    const { host } = fakeHost((request) =>
      request.url.endsWith("/missing")
        ? Response.json(
            { type: "about:blank", title: "Not found", status: 404, detail: "Product was not found" },
            { status: 404, headers: { "Content-Type": "application/problem+json" } },
          )
        : Response.json({ type: "about:blank", title: "Too many requests", status: 429, detail: "Slow down" }, { status: 429, headers: { "Retry-After": "60" } }),
    );
    const missing = await callTool(
      host,
      "execute",
      `async () => { try { await codemode.request({ method: "GET", path: "/api/products/missing" }); } catch (error) { return error.message; } }`,
    );
    expect(missing.text).toBe("GET /api/products/missing answered 404: Product was not found");
    const busy = await callTool(host, "execute", `async () => codemode.request({ method: "GET", path: "/api/products" })`);
    expect(busy.isError).toBe(true);
    expect(busy.text).toContain("answered 429: Slow down Retry after 60 seconds.");
  });

  it("refuses an answer too large to hand to the sandbox", async () => {
    const { host } = fakeHost(() => new Response(new Uint8Array(MAX_READ_BYTES + 1)));
    const answer = await callTool(host, "execute", `async () => codemode.request({ method: "GET", path: "/api/products/arvores/records/all" })`);
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("is larger than 8 MB");
  });

  it("answers a spent run allowance as a tool error the model can read", async () => {
    let asked = 0;
    const { host } = fakeHost(
      products,
      limitRuns(localExecutor, async () => (asked += 1) > 1 && false),
    );
    const answer = await callTool(host, "execute", `async () => "ran"`);
    expect(answer).toEqual({ isError: true, text: "Error: This client ran too much code in the last minute; wait 60 seconds and try again." });
    expect(asked).toBe(1);
  });

  it("sends people to the guide and has no stream or session to open", async () => {
    const { host } = fakeHost(products);
    const browser = await handleMcp(new Request("https://open-data.pt/mcp", { headers: { Accept: "text/html,application/xhtml+xml" } }), host);
    expect(browser.status).toBe(302);
    expect(browser.headers.get("Location")).toBe("https://open-data.pt/start/#mcp");
    const stream = await handleMcp(new Request("https://open-data.pt/mcp", { headers: { Accept: "text/event-stream" } }), host);
    expect(stream.status).toBe(405);
    expect(stream.headers.get("Allow")).toBe("POST, OPTIONS");
    const ended = await handleMcp(new Request("https://open-data.pt/mcp", { method: "DELETE" }), host);
    expect(ended.status).toBe(405);
    const preflight = await handleMcp(new Request("https://open-data.pt/mcp", { method: "OPTIONS" }), host);
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain("Mcp-Protocol-Version");
  });
});
