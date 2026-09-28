export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Extra response headers: Retry-After, Allow, a request ID. */
export type HeaderMap = Record<string, string>;

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
