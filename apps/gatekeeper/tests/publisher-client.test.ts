import { describe, expect, it } from "vitest";
import { GatekeeperError } from "#/index";
import { USER_AGENT, publisherClient } from "#/publisher-client";

interface Seen {
  url: string;
  userAgent: string | null;
  redirect: RequestInit["redirect"];
  method: string | undefined;
}

/** A fetcher that records every request and answers from a table of redirects. */
function recorder(redirects: Record<string, string> = {}, status = 302) {
  const seen: Seen[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input.href : input instanceof Request ? input.url : input;
    seen.push({ url, userAgent: new Headers(init?.headers).get("User-Agent"), redirect: init?.redirect, method: init?.method });
    const location = redirects[url];
    return location ? new Response(null, { status, headers: { Location: location } }) : new Response("ok");
  };
  return { seen, fetcher };
}

describe("a publisher's client", () => {
  it("names open-data.pt in every request, and adds what the publisher asked for", async () => {
    const { seen, fetcher } = recorder();
    const client = publisherClient([{ host: "stat.ripe.net", query: { sourceapp: "open-data.pt" } }, "www.ripe.net"], fetcher);
    await client("https://stat.ripe.net/data/country-resource-list/data.json?resource=PT", { headers: { "User-Agent": "something else" } });
    await client(new URL("https://www.ripe.net/"));
    expect(seen.map((request) => request.url)).toEqual(["https://stat.ripe.net/data/country-resource-list/data.json?resource=PT&sourceapp=open-data.pt", "https://www.ripe.net/"]);
    expect(seen.map((request) => request.userAgent)).toEqual([USER_AGENT, USER_AGENT]);
  });

  it("keeps a query parameter the request already sets", async () => {
    const { seen, fetcher } = recorder();
    await publisherClient([{ host: "stat.ripe.net", query: { sourceapp: "open-data.pt" } }], fetcher)("https://stat.ripe.net/x?sourceapp=mine");
    expect(seen[0]?.url).toBe("https://stat.ripe.net/x?sourceapp=mine");
  });

  it("refuses a host the publisher does not declare, before any request", async () => {
    const { seen, fetcher } = recorder();
    await expect(publisherClient(["dados.gov.pt"], fetcher)("https://example.com/file.csv")).rejects.toBeInstanceOf(GatekeeperError);
    expect(seen).toEqual([]);
  });

  it("follows a redirect within the declared hosts, and refuses one that leaves them", async () => {
    const within = recorder({ "https://dados.gov.pt/r/1": "https://static.dados.gov.pt/file.csv" });
    const answer = await publisherClient(["dados.gov.pt", "static.dados.gov.pt"], within.fetcher)("https://dados.gov.pt/r/1");
    expect(await answer.text()).toBe("ok");
    expect(within.seen.map((request) => [request.url, request.redirect, request.userAgent])).toEqual([
      ["https://dados.gov.pt/r/1", "manual", USER_AGENT],
      ["https://static.dados.gov.pt/file.csv", "manual", USER_AGENT],
    ]);
    const away = recorder({ "https://dados.gov.pt/r/1": "https://elsewhere.example/file.csv" });
    await expect(publisherClient(["dados.gov.pt"], away.fetcher)("https://dados.gov.pt/r/1")).rejects.toMatchObject({ code: "source-denied" });
    expect(away.seen).toHaveLength(1);
  });

  it("turns a POST answered with a 303 into a GET, as a browser does", async () => {
    const { seen, fetcher } = recorder({ "https://snirh.apambiente.pt/form": "https://snirh.apambiente.pt/result" }, 303);
    await publisherClient(["snirh.apambiente.pt"], fetcher)("https://snirh.apambiente.pt/form", { method: "POST", body: "a=1" });
    expect(seen.map((request) => request.method)).toEqual(["POST", "GET"]);
  });

  it("leaves a redirect to a caller that asked to handle it, whose next request comes back through the client", async () => {
    const { seen, fetcher } = recorder({ "https://www.parlamento.pt/a": "https://app.parlamento.pt/b" });
    const answer = await publisherClient(["www.parlamento.pt"], fetcher)("https://www.parlamento.pt/a", { redirect: "manual" });
    expect(answer.status).toBe(302);
    expect(seen).toHaveLength(1);
  });

  it("stops a redirect loop", async () => {
    const { fetcher } = recorder({ "https://dados.gov.pt/a": "https://dados.gov.pt/a" });
    await expect(publisherClient(["dados.gov.pt"], fetcher)("https://dados.gov.pt/a")).rejects.toThrow(/redirects/);
  });
});
