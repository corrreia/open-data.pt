import type { JsonValue } from "@open-data-pt/gatekeeper-shared";
import { describe, expect, it, vi } from "vitest";
import {
  collectDgegFeed,
  DGEG_API_ORIGIN,
  FUEL_TYPES_MAX_BYTES,
  validateDgegFeedConfig,
} from "../packages/gatekeeper-shared/src/sources/dgeg/dgeg";

const fuelTypes = {
  status: true,
  mensagem: "sucesso",
  resultado: [
    { Id: 3201, Descritivo: "Gasolina simples 95", UnidadeMedida: "litro" },
    { Id: 2101, Descritivo: "Gasóleo simples", UnidadeMedida: "litro" },
  ],
};
const districts = {
  status: true,
  mensagem: "sucesso",
  resultado: [{ Id: 11, Descritivo: "Lisboa" }],
};

function json(value: JsonValue | undefined, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function referenceFetcher() {
  return vi.fn(async (input: URL | RequestInfo) => {
    const url = input.toString();
    if (url.endsWith("/GetTiposCombustiveis")) return json(fuelTypes);
    if (url.endsWith("/GetDistritos")) return json(districts);
    throw new Error(`Unexpected request: ${url}`);
  });
}

describe("DGEG Gatekeeper", () => {
  it("normalizes and validates fuel and district identifiers against the source lists", async () => {
    const fetcher = referenceFetcher();
    await expect(validateDgegFeedConfig(
      { feed: "fuel-prices", fuelTypeId: "03201", districtId: "011" },
      DGEG_API_ORIGIN,
      fetcher,
    )).resolves.toEqual({
      feed: "fuel-prices",
      fuelTypeId: "3201",
      districtId: "11",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects caller-provided hosts and a configured origin outside the allowlist", async () => {
    const fetcher = referenceFetcher();
    await expect(validateDgegFeedConfig(
      { feed: "fuel-prices", fuelTypeId: "3201", host: "evil.example" },
      DGEG_API_ORIGIN,
      fetcher,
    )).rejects.toMatchObject({ code: "source-denied" });
    await expect(validateDgegFeedConfig(
      { feed: "fuel-prices", fuelTypeId: "3201" },
      "https://evil.example",
      fetcher,
    )).rejects.toMatchObject({ code: "source-denied" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("collects one district into a deterministic document with typed provenance", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith("/GetTiposCombustiveis")) return json(fuelTypes);
      if (url.pathname.endsWith("/GetDistritos")) return json(districts);
      expect(url.searchParams.get("idsTiposComb")).toBe("3201");
      expect(url.searchParams.get("idDistrito")).toBe("11");
      expect(url.searchParams.get("qtdPorPagina")).toBe("500");
      return json({
        status: true,
        mensagem: "sucesso",
        resultado: [
          {
            Id: 1,
            Nome: "Posto A",
            Municipio: "Lisboa",
            Distrito: "Lisboa",
            Preco: "1,799 €",
            DataAtualizacao: "2026-09-07 10:00",
            Quantidade: 1,
          },
        ],
      });
    });

    const config = { feed: "fuel-prices", fuelTypeId: "3201", districtId: "11" };
    const fetched = await collectDgegFeed(config, undefined, DGEG_API_ORIGIN, fetcher, { requestDelayMs: 0 });

    if (fetched.kind !== "body") throw new Error(`Expected a source body, got ${fetched.kind}`);
    expect(fetched.completeness).toBe("complete");
    expect(fetched.provenance.sourceUrl).toContain("idDistrito=11");
    expect(fetched.provenance.sourcePublishedAt).toBe("2026-09-07T09:00:00.000Z");
    expect(fetched.validator?.etag).toMatch(/^"sha256-[0-9a-f]{64}"$/);
    await expect(new Response(fetched.body).json()).resolves.toMatchObject({
      fuelType: { Id: 3201 },
      district: { Id: 11 },
      fetchedPages: 1,
      stations: [{ Id: 1 }],
    });

    // The combined document's content hash is its validator: the same content is not modified.
    const again = await collectDgegFeed(config, fetched.validator, DGEG_API_ORIGIN, fetcher, { requestDelayMs: 0 });
    expect(again).toEqual({ kind: "not-modified", validator: fetched.validator });
  });

  it("forwards upstream validators and Last-Modified provenance for fuel types", async () => {
    const fetcher = vi.fn(async () => json(fuelTypes, {
      ETag: '"types-v2"',
      "Last-Modified": "Mon, 07 Sep 2026 09:00:00 GMT",
    }));

    const fetched = await collectDgegFeed({ feed: "fuel-types" }, undefined, DGEG_API_ORIGIN, fetcher);

    expect(fetched).toMatchObject({
      kind: "body",
      completeness: "complete",
      provenance: {
        sourceUrl: `${DGEG_API_ORIGIN}/api/PrecoComb/GetTiposCombustiveis`,
        sourcePublishedAt: "2026-09-07T09:00:00.000Z",
      },
      validator: { etag: '"types-v2"', lastModified: "Mon, 07 Sep 2026 09:00:00 GMT" },
    });
  });

  it("forwards checkpoints and passes through a provider 304", async () => {
    const fetcher = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("if-none-match")).toBe('"source-v1"');
      expect(headers.get("if-modified-since")).toBe("Mon, 07 Sep 2026 09:00:00 GMT");
      return new Response(null, {
        status: 304,
        headers: { ETag: '"source-v1"' },
      });
    });

    const fetched = await collectDgegFeed(
      { feed: "fuel-types" },
      {
        etag: '"source-v1"',
        lastModified: "Mon, 07 Sep 2026 09:00:00 GMT",
      },
      DGEG_API_ORIGIN,
      fetcher,
    );

    expect(fetched).toEqual({ kind: "not-modified", validator: { etag: '"source-v1"' } });
  });

  it("rejects a declared source body above the feed-kind size cap", async () => {
    const fetcher = vi.fn(async () => new Response("{}", {
      headers: { "content-length": String(FUEL_TYPES_MAX_BYTES + 1) },
    }));
    await expect(collectDgegFeed(
      { feed: "fuel-types" },
      undefined,
      DGEG_API_ORIGIN,
      fetcher,
    )).rejects.toMatchObject({ code: "response-too-large" });
  });

  it("turns provider failures into an upstream error", async () => {
    const fetcher = vi.fn(async () => new Response("unavailable", { status: 503 }));
    await expect(collectDgegFeed(
      { feed: "fuel-types" },
      undefined,
      DGEG_API_ORIGIN,
      fetcher,
    )).rejects.toMatchObject({ code: "upstream-error" });
  });
});
