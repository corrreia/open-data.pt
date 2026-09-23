import { createHash } from "node:crypto";
import { readFixture } from "#/tests/support";
import { describe, expect, it } from "vitest";
import { libraryConfig, type JsonObject, type SourceFetch, type SourceStaging } from "#/index";
import { resolveParliamentFeed } from "#/publishers/assembleia-da-republica/parliament/index";
import {
  collectParliamentFeed,
  parliamentDirectoryLink,
  parliamentDocument,
  parliamentDocumentLink,
  PARLIAMENT_HTML_BYTES,
  validateParliamentFeedConfig,
  type ParliamentDocument,
} from "#/publishers/assembleia-da-republica/parliament/parliament";
import { feedsOf } from "#/tests/catalog";

const config = { feed: "members", legislature: "XVII" };
const document = parliamentDocument(config);
interface PublicDirectoryFixture {
  landing: string;
  folder: string;
  download: string;
}
function links(doc: ParliamentDocument, token = "c3ludGhldGljLXBhdGg="): PublicDirectoryFixture {
  const folder = new URL(doc.pageUrl);
  folder.searchParams.set("t", "abcdef0123456789");
  folder.searchParams.set("Path", token);
  const download = new URL("https://app.parlamento.pt/webutils/docs/doc.txt");
  download.searchParams.set("path", token);
  download.searchParams.set("fich", doc.filename);
  download.searchParams.set("Inline", "true");
  const escaped = (value: string) => value.replaceAll("&", "&amp;");
  return {
    landing: `<link rel="canonical" href="http://www.parlamento.pt:80/"><a href="${escaped(folder.pathname + folder.search)}" title="Pasta ${doc.legislature} Legislatura">Folder</a>`,
    folder: `<a title="${doc.filename}" href="${escaped(download.toString())}">JSON</a>`,
    download: download.toString(),
  };
}
function fixture(feed: string): string {
  return readFixture(new URL(`./fixtures/${feed}.json`, import.meta.url));
}
function chunked(text: string, size = 1): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const chunk = bytes.slice(offset, offset + size);
      offset += chunk.length;
      controller.enqueue(chunk);
    },
  });
}
function sourceFetcher(doc: ParliamentDocument, status = 200, token?: string): typeof fetch {
  const html = links(doc, token);
  return async (input) => {
    const url = new URL(input.toString());
    if (url.origin === "https://www.parlamento.pt") return new Response(url.search ? html.folder : html.landing);
    expect(url.toString()).toBe(html.download);
    return status === 304
      ? new Response(null, { status: 304 })
      : new Response(chunked(fixture(doc.feed)), { headers: { ETag: '"document-v1"', "Last-Modified": "Tue, 15 Sep 2026 12:00:00 GMT" } });
  };
}
async function consume(source: SourceFetch): Promise<void> {
  if (source.kind === "body") await new Response(source.body).arrayBuffer();
}

describe("Parliament public-directory source", () => {
  it("requires a supported feed and explicit legislature with no arbitrary URL, host or credentials", () => {
    expect(validateParliamentFeedConfig({ feed: " members ", legislature: " xvii " })).toEqual(config);
    for (const invalid of [
      { feed: "members" },
      { ...config, legislature: "current" },
      { ...config, legislature: "XVIII" },
      { ...config, feed: "private" },
      { ...config, url: "https://attacker.example" },
      { ...config, downloadUrl: links(document).download },
      { ...config, host: "app.parlamento.pt:8443" },
    ])
      expect(() => validateParliamentFeedConfig(invalid)).toThrow();
  });

  it.each(feedsOf("parliament"))("resolves stable selected-file identity for $slug", async (example) => {
    const raw = libraryConfig(example.config);
    const first = await resolveParliamentFeed(raw);
    const second = await resolveParliamentFeed({ ...raw });
    expect(first).toEqual(second);
    expect(first.resourceKey).toContain(`parliament:${raw.feed}:`);
    expect(first.history).toBeUndefined();
    expect(raw.legislature).toBe("XVII");
    expect(Object.values(raw).some((value) => value.includes("http"))).toBe(false);
    expect(example.policy.collection.cadenceSeconds).toBe(raw.feed === "careers" ? 604_800 : 86_400);
  });

  it("discovers two levels, decodes entities, and ignores the publisher's HTTP canonical URL", async () => {
    const calls: URL[] = [];
    const inner = sourceFetcher(document);
    const result = await collectParliamentFeed(config, undefined, async (input, init) => {
      calls.push(new URL(input.toString()));
      expect(init?.redirect).toBe("manual");
      return inner(input, init);
    });
    await consume(result);
    expect(calls).toHaveLength(3);
    expect(calls[0]?.toString()).toBe(document.pageUrl);
    expect(calls[1]?.pathname).toBe(new URL(document.pageUrl).pathname);
    expect(calls[1]?.searchParams.get("Path")).toBe("c3ludGhldGljLXBhdGg=");
    expect(calls[2]?.searchParams.get("fich")).toBe(document.filename);
    expect(calls.every((url) => url.protocol === "https:")).toBe(true);
    expect(result).toMatchObject({
      kind: "body",
      completeness: "complete",
      provenance: { sourceUrl: document.pageUrl, sourcePublishedAt: "2026-09-15T12:00:00.000Z" },
      state: { resource: document.filename, validators: { default: { etag: '"document-v1"' } } },
    });
    const numericEntities = links(document).landing.replaceAll("&amp;", "&#x26;");
    expect(parliamentDirectoryLink(numericEntities, document).searchParams.has("Path")).toBe(true);
  });

  it("checks every directory/download boundary rather than trusting an anchor title", () => {
    const directoryUrls = [
      "https://attacker.example/Cidadania/Paginas/DAInformacaoBase.aspx?t=ab&Path=x",
      "http://www.parlamento.pt/Cidadania/Paginas/DAInformacaoBase.aspx?t=ab&Path=x",
      "https://www.parlamento.pt/Cidadania/Paginas/Other.aspx?t=ab&Path=x",
      "https://user@www.parlamento.pt/Cidadania/Paginas/DAInformacaoBase.aspx?t=ab&Path=x",
      `${document.pageUrl}?t=ab&Path=x&Path=y`,
      `${document.pageUrl}?t=not-hex&Path=x`,
      `${document.pageUrl}?t=ab&Path=x#fragment`,
    ];
    for (const url of directoryUrls) expect(() => parliamentDirectoryLink(`<a title="Pasta XVII Legislatura" href="${url}">Folder</a>`, document)).toThrow();
    const download = links(document).download;
    const invalid = [
      download.replace("app.parlamento.pt", "attacker.example"),
      download.replace("https:", "http:"),
      download.replace("app.parlamento.pt", "app.parlamento.pt:8443"),
      download.replace("app.parlamento.pt", "user:password@app.parlamento.pt"),
      download.replace("doc.txt", "other.txt"),
      download.replace(document.filename, "InformacaoBaseXVI_json.txt"),
      `${download}&fich=${document.filename}`,
      download.replace("Inline=true", "Inline=false"),
      "javascript:alert(1)",
    ];
    for (const url of invalid) expect(() => parliamentDocumentLink(`<a title="${document.filename}" href="${url}">JSON</a>`, document)).toThrow();
  });

  it("rejects missing/ambiguous links, repeated attributes and links inside scripts/comments", () => {
    const valid = links(document).folder;
    expect(() => parliamentDocumentLink("No file", document)).toThrow("uniquely");
    expect(() => parliamentDocumentLink(valid + valid.replace("c3ludGhldGljLXBhdGg", "another-token"), document)).toThrow("uniquely");
    expect(() => parliamentDocumentLink(valid.replace("<a ", '<a href="https://attacker.example/" '), document)).toThrow("repeats");
    expect(() => parliamentDocumentLink(`<script>${valid}</script><!--${valid}-->`, document)).toThrow("uniquely");
  });

  it("scopes conditional requests to the logical file even when encrypted links refresh", async () => {
    const first = await collectParliamentFeed(config, undefined, sourceFetcher(document));
    await consume(first);
    if (first.kind !== "body") throw new Error("Expected body");
    const calls: Headers[] = [];
    const inner = sourceFetcher(document, 304, "bmV3LXN5bnRoZXRpYy10b2tlbg=");
    const unchanged = await collectParliamentFeed(config, first.state, async (input, init) => {
      calls.push(new Headers(init?.headers));
      return inner(input, init);
    });
    expect(unchanged).toEqual({ kind: "not-modified", validator: { etag: '"document-v1"', lastModified: "Tue, 15 Sep 2026 12:00:00 GMT" } });
    expect(calls[0]?.has("if-none-match")).toBe(false);
    expect(calls[1]?.has("if-none-match")).toBe(false);
    expect(calls[2]?.get("if-none-match")).toBe('"document-v1"');
    const wrongScope: JsonObject = { ...first.state, resource: "InformacaoBaseXVI_json.txt" };
    const normal = sourceFetcher(document);
    await consume(
      await collectParliamentFeed(config, wrongScope, async (input, init) => {
        expect(new Headers(init?.headers).has("if-none-match")).toBe(false);
        return normal(input, init);
      }),
    );
  });

  it("stages a download without validators and skips parsing when its digest has not changed", async () => {
    const initiatives = parliamentDocument({ feed: "initiatives", legislature: "XVII" });
    const html = links(initiatives);
    let text = fixture("initiatives");
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(input.toString());
      if (url.origin === "https://www.parlamento.pt") return new Response(url.search ? html.folder : html.landing);
      const bytes = new TextEncoder().encode(text);
      return new Response(chunked(text, 64), { headers: { "Content-Length": String(bytes.length) } });
    };
    const stored = new Map<string, Uint8Array>();
    const staging: SourceStaging = {
      async store(key, body, length) {
        const bytes = new Uint8Array(await new Response(body).arrayBuffer());
        expect(bytes.length).toBe(length);
        stored.set(key, bytes);
        return `md5:${createHash("md5").update(bytes).digest("hex")}`;
      },
      async read(key) {
        return new Response(stored.get(key)).body!;
      },
    };
    const config = { feed: "initiatives", legislature: "XVII" };
    const first = await collectParliamentFeed(config, undefined, fetcher, staging);
    if (first.kind !== "body") throw new Error("Expected a staged body");
    expect(new TextDecoder().decode(await new Response(first.body).arrayBuffer())).toBe(text);
    expect(first.state).toEqual({ resource: initiatives.filename, digest: `md5:${createHash("md5").update(text).digest("hex")}` });
    expect([...stored.keys()]).toEqual([`parliament/${initiatives.filename}`]);
    expect(await collectParliamentFeed(config, first.state, fetcher, staging)).toEqual({ kind: "not-modified" });
    // Another legislature's file never counts as this one unchanged.
    expect((await collectParliamentFeed(config, { ...first.state, resource: "IniciativasXVI_json.txt" }, fetcher, staging)).kind).toBe("body");
    text = text.replace("Synthetic bill", "Synthetic bill, amended");
    const changed = await collectParliamentFeed(config, first.state, fetcher, staging);
    expect(changed.kind).toBe("body");
    await consume(changed);
  });

  it("rejects unsolicited304s and redirects and clears validators a source stops supplying", async () => {
    await expect(collectParliamentFeed(config, undefined, sourceFetcher(document, 304))).rejects.toThrow("unsolicited");
    await expect(
      collectParliamentFeed(config, undefined, async () => new Response(null, { status: 302, headers: { Location: "https://attacker.example" } })),
    ).rejects.toMatchObject({ code: "source-denied" });
    const html = links(document);
    const result = await collectParliamentFeed(config, { resource: document.filename, validators: { default: { etag: '"old"' } } }, async (input) => {
      const url = new URL(input.toString());
      return new Response(url.hostname === "www.parlamento.pt" ? (url.search ? html.folder : html.landing) : fixture("members"));
    });
    await consume(result);
    expect(result).toMatchObject({ kind: "body", state: { resource: document.filename } });
    if (result.kind === "body") expect(result.state).not.toHaveProperty("validators");
  });

  it("bounds directory and source bodies and forwards upstream Retry-After", async () => {
    await expect(
      collectParliamentFeed(config, undefined, async () => new Response("x", { headers: { "Content-Length": String(PARLIAMENT_HTML_BYTES + 1) } })),
    ).rejects.toMatchObject({ code: "response-too-large" });
    await expect(
      collectParliamentFeed(config, undefined, async () => {
        throw new TypeError("Network unavailable");
      }),
    ).rejects.toMatchObject({ code: "upstream-error" });
    await expect(collectParliamentFeed(config, undefined, async () => new Response(null, { status: 503, headers: { "Retry-After": "120" } }))).rejects.toMatchObject({
      code: "upstream-error",
      retryAfterSeconds: 120,
    });
    const inner = sourceFetcher(document);
    await expect(
      collectParliamentFeed(config, undefined, async (input, init) =>
        new URL(input.toString()).hostname === "app.parlamento.pt" ? new Response("x", { headers: { "Content-Length": String(document.sourceBytes + 1) } }) : inner(input, init),
      ),
    ).rejects.toMatchObject({ code: "response-too-large" });
    const fetched = await collectParliamentFeed(config, undefined, async (input, init) =>
      new URL(input.toString()).hostname === "app.parlamento.pt" ? new Response(new Uint8Array(document.sourceBytes + 1)) : inner(input, init),
    );
    await expect(consume(fetched)).rejects.toMatchObject({ code: "response-too-large" });
  });
});
