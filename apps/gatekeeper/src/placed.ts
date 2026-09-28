import { NormalizedInputError, isJsonObject, parseJson, type CollectionRequest, type CollectionResult } from "@open-data-pt/contract";

/*
 * Collections that run where Cloudflare places this Worker's `fetch` handler.
 *
 * Placement (`placement.hostname` in the Worker's configuration) moves only a
 * Worker's `fetch` handler, never its RPC methods, and a request to a service
 * binding counts against the 32 Worker invocations one request may make. So a
 * library that must be read from near its source does not send its requests
 * through the handler one by one: its whole collection is one request to the
 * handler, which runs it there and streams the result back.
 */

/** The path a placed collection is asked for on; the handler answers nothing else. */
export const PLACED_COLLECTION_PATH = "/placed-collection";

/** Carries the result's kind; a batch's normalized stream is the body, anything else is the result as JSON. */
const RESULT_HEADER = "x-collection-result";

/** The request the Worker sends its own `fetch` handler for one placed collection. */
export function placedRequest(collection: CollectionRequest): Request {
  return new Request(`https://gatekeeper.internal${PLACED_COLLECTION_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(collection),
  });
}

/** The collection a placed request asks for, read back by the handler. */
export async function collectionOf(request: Request): Promise<CollectionRequest> {
  const parsed = parseJson(await request.text());
  if (!isJsonObject(parsed)) throw new NormalizedInputError("A placed collection was asked for without a collection request");
  const untrusted: unknown = parsed;
  // SAFETY: only this Worker reaches its own `fetch` handler (no route, no workers.dev URL), and it sends a CollectionRequest.
  return untrusted as CollectionRequest;
}

/** A collection's result as the handler answers it. */
export function placedResponse(result: CollectionResult): Response {
  if (result.kind === "batch") return new Response(result.stream, { headers: { [RESULT_HEADER]: "batch", "content-type": "application/x-ndjson" } });
  return new Response(JSON.stringify(result), { headers: { [RESULT_HEADER]: result.kind, "content-type": "application/json" } });
}

/** The result a placed collection answered, as `collect` hands it to the kernel. */
export async function placedResult(response: Response): Promise<CollectionResult> {
  const kind = response.headers.get(RESULT_HEADER);
  if (kind === "batch" && response.body) return { kind: "batch", stream: response.body };
  if (kind === null) throw new Error(`The placed collection answered HTTP ${response.status} without a result`);
  const parsed = parseJson(await response.text());
  if (!isJsonObject(parsed)) throw new NormalizedInputError("A placed collection answered a result that is not an object");
  const untrusted: unknown = parsed;
  // SAFETY: the handler serialized a CollectionResult of this kind, and the kernel validates every result it receives.
  return untrusted as CollectionResult;
}
