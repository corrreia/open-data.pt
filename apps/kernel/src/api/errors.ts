export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Selected internal storage is temporarily absent; the public resource still exists. */
export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

/** Extra response headers: Retry-After, Allow, a request ID. */
export type HeaderMap = Record<string, string>;

/** Operational headers browser code may read from a cross-origin problem. */
export const EXPOSED_PROBLEM_HEADERS = "Retry-After, X-Request-Id, Allow, Link, ETag";

/** Reject malformed percent-encoding anywhere in an API path. */
export function validatePathEncoding(pathname: string): void {
  try {
    decodeURI(pathname);
  } catch {
    throw new RequestError("Path contains malformed percent-encoding", 400);
  }
}

/** A path member decoded as UTF-8, with malformed percent-encoding treated as a client error. */
export function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new RequestError("Path contains malformed percent-encoding", 400);
  }
}

/** A selected internal object is absent although its public resource still exists. */
export function storageUnavailableResponse(error: StorageUnavailableError): Response {
  return Response.json(
    { type: "about:blank", title: "Storage unavailable", status: 503, detail: error.message },
    {
      status: 503,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": EXPOSED_PROBLEM_HEADERS,
        "Cache-Control": "no-store",
        "Content-Type": "application/problem+json",
        "Retry-After": "30",
      },
    },
  );
}

/** A request the API refuses as asked, with the status and headers it answers. */
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly headers: HeaderMap = {},
  ) {
    super(message);
    this.name = "RequestError";
  }
}
