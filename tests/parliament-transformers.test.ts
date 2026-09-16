import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isJsonArray, isJsonObject, libraryConfig, parseJson,
  type CanonicalRecord, type JsonObject, type JsonValue, type ProductDeclaration, type StreamingSummary, type TransformContext,
} from "@open-data-pt/gatekeeper-shared";
import { PARLIAMENT_EXAMPLES, transformParliament } from "../packages/gatekeeper-shared/src/sources/parliament";
import { PARLIAMENT_ELEMENT_BYTES } from "../packages/gatekeeper-shared/src/sources/parliament/transform";

function fixture(feed: string): JsonValue { return parseJson(readFileSync(new URL(`./fixtures/parliament/${feed}.json`, import.meta.url), "utf8")); }
function object(value: JsonValue | undefined): JsonObject { if (!isJsonObject(value)) throw new Error("Expected fixture object"); return value; }
function array(value: JsonValue | undefined): JsonValue[] { if (!isJsonArray(value)) throw new Error("Expected fixture array"); return value; }
function body(text: string, chunkSize = 1): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text); let offset = 0;
  return new ReadableStream({ pull(controller) { if (offset === bytes.length) { controller.close(); return; } const chunk = bytes.slice(offset, offset + chunkSize); offset += chunk.length; controller.enqueue(chunk); } });
}
function context(feed: string, observedAt = "2026-09-15T00:00:00Z"): TransformContext {
  const example = PARLIAMENT_EXAMPLES.find((example) => example.config.feed === feed);
  if (!example) throw new Error("Missing Parliament example");
  return { observedAt, feed: { slug: example.slug, title: example.title, description: example.description, config: libraryConfig(example.config), semantics: { domainSubject: "reference", defaultProductRole: "reference" } } };
}
interface Result { products: ProductDeclaration[]; records: Map<string, CanonicalRecord[]>; summary: StreamingSummary }
async function run(feed: string, value = fixture(feed), chunkSize = 1, observedAt?: string): Promise<Result> { return runText(feed, JSON.stringify(value), chunkSize, observedAt); }
async function runText(feed: string, text: string, chunkSize = 1, observedAt?: string): Promise<Result> {
  const transformed = transformParliament(body(text, chunkSize), context(feed, observedAt)); const records = new Map<string, CanonicalRecord[]>();
  for await (const row of transformed.rows) {
    if (!row.record) throw new Error("Parliament emitted a duplicate series product");
    const values = records.get(row.productKey) ?? []; values.push(row.record); records.set(row.productKey, values);
  }
  return { products: transformed.products, records, summary: transformed.finish() };
}


describe("Parliament streaming normalization", () => {
  it.each(PARLIAMENT_EXAMPLES)("is acquisition-clock independent for $slug, including one-byte UTF-8 chunks", async (example) => {
    const feed = example.config.feed ?? "";
    const first = await run(feed); const later = await run(feed, fixture(feed), 31, "2027-01-01T12:00:00Z");
    expect(first).toEqual(later);
    expect(first.products.every((product) => product.kind === "record" && product.updateMode === "authoritative-snapshot")).toBe(true);
    expect(first.summary.quality.rejectedRecords).toBe(0);
    const bom = await runText(feed, `﻿${JSON.stringify(fixture(feed))}`, 1);
    expect(bom).toEqual(first);
  });

  it("keeps source mandates and statuses instead of filtering to currently active members", async () => {
    const result = await run("members");
    expect(Object.fromEntries([...result.records].map(([key, rows]) => [key, rows.length]))).toEqual({ mandates: 2, constituencies: 1, "parliamentary-groups": 1, sessions: 1 });
    const first = result.records.get("mandates")?.[0];
    expect(first?.entityKey).toBe("50000001");
    expect(first?.payload.person_id).toBe("40000001");
    expect(first?.payload.mandate_statuses).toEqual([{ description: "Renunciou", start_date: "2026-06-10", end_date: null, member_type: null }]);
    expect(first?.eventTime).toBeUndefined();
    expect(first?.sourcePublishedAt).toBeUndefined();
  });

  it("publishes useful career additions only and excludes private/sensitive fields", async () => {
    const data = array(fixture("careers"));
    Object.assign(object(data[0]), { CadDtNascimento: "PRIVATE_SENTINEL", CadSexo: "PRIVATE_SENTINEL", private_contact: "PRIVATE_SENTINEL", CadDeputadoLegis: [{ private: "PRIVATE_SENTINEL" }] });
    const result = await run("careers", data);
    const profiles = result.records.get("professional-profiles");
    expect(profiles).toHaveLength(1);
    expect(profiles?.[0]?.payload.profession).toBe("Engineer");
    expect(profiles?.[0]?.payload.qualifications).toEqual(["Synthetic qualification"]);
    expect(JSON.stringify(profiles)).not.toContain("PRIVATE_SENTINEL");
    expect(JSON.stringify(profiles)).not.toContain("CadDtNascimento");
    expect(profiles?.[0]?.eventTime).toBeUndefined();
  });

  it("keeps petition count/date semantics without copying authors or private nested documents", async () => {
    const data = array(fixture("petitions")); const first = object(data[0]);
    first.PetAutor = "PRIVATE_SENTINEL"; first.Documentos = [{ body: "PRIVATE_SENTINEL" }];
    object(array(first.DadosComissao)[0]).DocumentosPeticao = { submissions: ["PRIVATE_SENTINEL"] };
    const result = await run("petitions", data);
    const records = result.records.get("petitions");
    expect(records?.[0]).toMatchObject({ entityKey: "60000001", eventTime: "2026-06-15T00:00:00.000Z", payload: { signatures: 1234, initial_signatures: 1000, entry_date: "2026-06-15" } });
    expect(records?.[1]?.payload.signatures).toBe(0);
    expect(JSON.stringify(records)).not.toContain("PRIVATE_SENTINEL");
  });

  it("dates legislation from actual publications, never its numeric year or the poll time", async () => {
    const result = await run("diplomas"); const records = result.records.get("diplomas");
    expect(records?.[0]).toMatchObject({ eventTime: "2026-06-20T00:00:00.000Z", sourcePublishedAt: "2026-06-22T00:00:00.000Z", payload: { text_url: "https://app.parlamento.pt/example-law.pdf", civil_year: "2026" } });
    expect(records?.[1]?.eventTime).toBeUndefined();
    expect(records?.[1]?.sourcePublishedAt).toBeUndefined();
    const data = array(fixture("diplomas")); object(data[0]).LinkTexto = "javascript:alert(1)";
    const sanitized = await run("diplomas", data);
    expect(sanitized.records.get("diplomas")?.[0]?.payload.text_url).toBeNull();
  });

  it("splits five activity sections from one document without duplicating generic activity records", async () => {
    const result = await run("activities");
    expect(Object.fromEntries([...result.records].map(([key, rows]) => [key, rows.length]))).toEqual({ hearings: 1, audiences: 1, debates: 2, visits: 1, events: 1 });
    expect(result.summary.quality.acceptedRecords).toBe(6);
    expect(result.records.get("debates")?.[1]?.eventTime).toBeUndefined();
    expect(result.records.get("visits")?.[0]).toMatchObject({ eventTime: "2026-07-05T00:00:00.000Z", payload: { end_date: "2026-07-06" } });
  });

  it("preserves scoped committee membership history and Lisbon meeting clocks, with honest incomplete sub-products", async () => {
    const result = await run("committees");
    expect(result.records.get("memberships")?.[0]?.entityKey).toBe("70000001:50000001");
    expect(result.records.get("meetings")?.[0]).toMatchObject({ entityKey: "70000001:90000001", eventTime: "2026-07-08T13:30:00.000Z", payload: { starts_at: "2026-07-08T13:30:00.000Z", source_start: "2026-07-08T14:30:00" } });
    expect(result.summary.products).toContainEqual({ productKey: "memberships", completeness: "partial" });
    expect(result.summary.products?.find((product) => product.productKey === "meetings")?.completeness).toBe("partial");
    const data = object(fixture("committees")); const meeting = object(array(object(array(data.Comissoes)[0]).Reunioes)[0]);
    meeting.reuDataHora = "2026-10-25T01:30:00";
    const ambiguous = await run("committees", data);
    expect(ambiguous.records.get("meetings")?.[0]?.eventTime).toBeUndefined();
    expect(ambiguous.records.get("meetings")?.[0]?.payload.source_start).toBe("2026-10-25T01:30:00");
  });

  it("rejects duplicate identities, wrong-legislature payloads and incomplete required arrays", async () => {
    const petitions = array(fixture("petitions")); petitions.push(petitions[0] ?? null);
    await expect(run("petitions", petitions)).rejects.toThrow("repeated");
    const members = object(fixture("members")); object(array(members.Deputados)[0]).LegDes = "XVI";
    await expect(run("members", members)).rejects.toThrow("legislature");
    const activities = object(fixture("activities")); delete activities.Eventos;
    await expect(run("activities", activities)).rejects.toThrow("Eventos");
    await expect(run("members", {})).rejects.toThrow("Deputados");
    await expect(run("careers", {})).rejects.toThrow("root");
    await expect(run("members", [])).rejects.toThrow("root");
    await expect(run("petitions", [null])).rejects.toThrow("not an object");
  });

  it("fails malformed source dates and truncated documents rather than completing an authoritative snapshot", async () => {
    const data = array(fixture("petitions")); object(data[0]).PetDataEntrada = "2026-02-30";
    await expect(run("petitions", data)).rejects.toThrow("date");
    await expect(runText("activities", JSON.stringify(fixture("activities")).slice(0, -1))).rejects.toThrow();
    await expect(runText("petitions", "")).rejects.toThrow();
    expect((await run("petitions", [])).summary.quality.acceptedRecords).toBe(0);
  });

  it("enforces element and unrelated-envelope byte bounds", async () => {
    const data = array(fixture("petitions")); object(data[0]).unselected = "x".repeat(PARLIAMENT_ELEMENT_BYTES);
    await expect(run("petitions", data, 8192)).rejects.toMatchObject({ code: "response-too-large" });
    const activities = object(fixture("activities")); activities.unrelated = "x".repeat(2 * 1024 * 1024);
    await expect(run("activities", activities, 8192)).rejects.toMatchObject({ code: "response-too-large" });
  });
});
