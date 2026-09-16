import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { libraryConfig, readBoundedResponse } from "@open-data-pt/gatekeeper-shared";
import { PARLIAMENT_EXAMPLES } from "../packages/gatekeeper-shared/src/sources/parliament";
import { parliamentDirectoryLink, parliamentDocument, parliamentDocumentLink, PARLIAMENT_HTML_BYTES } from "../packages/gatekeeper-shared/src/sources/parliament/parliament";

const saved = process.env.PARLIAMENT_DIRECTORY_SAMPLES === "1";
const live = process.env.LIVE_PARLIAMENT_DIRECTORY === "1";
const DIRECTORY = process.env.PARLIAMENT_DIRECTORY_SAMPLE_DIR;

/** These tests inspect public directory HTML only. They never open document JSON or biography records. */
describe.skipIf(!saved)("Parliament recorded public-directory HTML", () => {
  it.each(PARLIAMENT_EXAMPLES)("identifies the actual two-level $slug download listing", (example) => {
    if (!DIRECTORY) throw new Error("Set PARLIAMENT_DIRECTORY_SAMPLE_DIR to a directory containing public listing HTML");
    const document = parliamentDocument(libraryConfig(example.config));
    const first = readFileSync(`${DIRECTORY}/parl_${document.page}.html`, "utf8");
    const second = readFileSync(`${DIRECTORY}/parl2_${document.page}.html`, "utf8");
    const directory = parliamentDirectoryLink(first, document);
    const download = parliamentDocumentLink(second, document);
    expect(directory.origin).toBe("https://www.parlamento.pt");
    expect(download.origin).toBe("https://app.parlamento.pt");
    expect(download.searchParams.get("fich")).toBe(document.filename);
    console.info(JSON.stringify({ mode: "recorded-public-directory", feed: document.feed, firstHtmlBytes: Buffer.byteLength(first), secondHtmlBytes: Buffer.byteLength(second), matched: true }));
  });
});

describe.skipIf(!live)("Parliament live public-directory HTML only", () => {
  it("discovers the members file without downloading its records", async () => {
    const document = parliamentDocument({ feed: "members", legislature: "XVII" });
    const fetchHtml = async (url: URL): Promise<string> => {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000), headers: { Accept: "text/html", "User-Agent": "open-data.pt (+https://open-data.pt)" } });
      expect(response.status).toBe(200);
      return new TextDecoder().decode(await readBoundedResponse(response, PARLIAMENT_HTML_BYTES, "public directory HTML"));
    };
    const first = await fetchHtml(new URL(document.pageUrl));
    const folder = parliamentDirectoryLink(first, document);
    const second = await fetchHtml(folder);
    const download = parliamentDocumentLink(second, document);
    expect(download.searchParams.get("fich")).toBe(document.filename);
    console.info(JSON.stringify({ mode: "live-public-directory-only", matched: true, recordsDownloaded: false }));
  }, 70_000);
});
