import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("names us as a host asks, where it asks for another name", async () => {
    const { seen, fetcher } = recorder();
    const client = publisherClient([{ host: "slow.example.pt", userAgent: "another name" }, "fast.example.pt"], fetcher);
    await client("https://slow.example.pt/a");
    await client("https://fast.example.pt/b");
    expect(seen.map((request) => request.userAgent)).toEqual(["another name", USER_AGENT]);
  });

  describe("an origin that never answered", () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    /** A fetcher that answers each request with the next of `answers`: a status, or a failed connection. */
    function answering(answers: Array<number | "refused">) {
      const bodies: Array<string | null> = [];
      const fetcher: typeof fetch = async (_input, init) => {
        bodies.push(init?.body === undefined || init.body === null ? null : String(init.body));
        const answer = answers.shift() ?? 200;
        if (answer === "refused") throw new TypeError("Network connection lost.");
        return new Response(answer === 522 ? "error code: 522" : "ok", { status: answer });
      };
      return { bodies, fetcher };
    }

    it("repeats a request the edge answered with 522, or whose connection failed, body and all, and logs the 522", async () => {
      vi.useFakeTimers();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { bodies, fetcher } = answering([522, "refused"]);
      const client = publisherClient(["snirh.apambiente.pt"], fetcher);
      const response = client("https://snirh.apambiente.pt/index.php", { method: "POST", body: "f_estado=ATIVA", redirect: "manual" });
      await vi.advanceTimersByTimeAsync(5_000);
      expect((await response).status).toBe(200);
      expect(bodies).toEqual(["f_estado=ATIVA", "f_estado=ATIVA", "f_estado=ATIVA"]);
      expect(warn.mock.calls.map((call) => JSON.parse(String(call[0])).status)).toEqual([522]);
    });

    it("gives the third attempt's answer or error as it stands", async () => {
      vi.useFakeTimers();
      const unreachable = answering([522, 522, 522, 200]);
      const response = publisherClient(["snirh.apambiente.pt"], unreachable.fetcher)("https://snirh.apambiente.pt/");
      await vi.advanceTimersByTimeAsync(5_000);
      expect((await response).status).toBe(522);
      const refused = answering(["refused", "refused", "refused", 200]);
      const failed = publisherClient(["snirh.apambiente.pt"], refused.fetcher)("https://snirh.apambiente.pt/");
      const settled = expect(failed).rejects.toThrow("Network connection lost.");
      await vi.advanceTimersByTimeAsync(5_000);
      await settled;
      expect(refused.bodies).toHaveLength(3);
    });

    it("does not repeat an answer from the origin, or a request whose body was a stream", async () => {
      const answered = answering([500]);
      expect((await publisherClient(["snirh.apambiente.pt"], answered.fetcher)("https://snirh.apambiente.pt/")).status).toBe(500);
      expect(answered.bodies).toHaveLength(1);
      const streamed = answering([522]);
      const body = new ReadableStream<Uint8Array>({ start: (controller) => controller.close() });
      expect((await publisherClient(["snirh.apambiente.pt"], streamed.fetcher)("https://snirh.apambiente.pt/", { method: "POST", body })).status).toBe(522);
      expect(streamed.bodies).toHaveLength(1);
    });
  });

  it("logs an answer that refused or failed a request, with who gave it, and nothing for one that succeeded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetcher: typeof fetch = async (input) =>
      String(input).endsWith("/refused")
        ? new Response("blocked", { status: 403, headers: { Server: "cloudflare", "cf-mitigated": "challenge", "Content-Type": "text/html" } })
        : new Response("ok");
    const client = publisherClient(["bpstat.bportugal.pt"], fetcher);
    await client("https://bpstat.bportugal.pt/data/ok");
    expect(warn).not.toHaveBeenCalled();
    expect((await client("https://bpstat.bportugal.pt/data/refused")).status).toBe(403);
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
      event: "source_http_status",
      host: "bpstat.bportugal.pt",
      path: "/data/refused",
      status: 403,
      server: "cloudflare",
      mitigated: "challenge",
      contentType: "text/html",
    });
    warn.mockRestore();
  });

  describe("a host's interval", () => {
    afterEach(() => vi.useRealTimers());

    it("spaces requests to it, from every client at once, and leaves other hosts alone", async () => {
      vi.useFakeTimers();
      const started: Array<[string, number]> = [];
      const fetcher: typeof fetch = async (input) => {
        started.push([new URL(input instanceof Request ? input.url : input.toString()).hostname, Date.now()]);
        return new Response("ok");
      };
      const sources = [{ host: "interval.example.pt", minIntervalSeconds: 5 }, "free.example.pt"];
      const first = publisherClient(sources, fetcher);
      const second = publisherClient(sources, fetcher);
      const t0 = Date.now();
      const requests = Promise.all([
        first("https://interval.example.pt/1"),
        second("https://interval.example.pt/2"),
        first("https://interval.example.pt/3"),
        second("https://free.example.pt/4"),
      ]);
      await vi.advanceTimersByTimeAsync(20_000);
      await requests;
      expect(started.map(([host, at]) => [host, at - t0])).toEqual([
        ["free.example.pt", 0],
        ["interval.example.pt", 0],
        ["interval.example.pt", 5_000],
        ["interval.example.pt", 10_000],
      ]);
    });
  });
});
