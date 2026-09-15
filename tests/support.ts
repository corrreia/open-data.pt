/**
 * Reading a fixture back. A test serves a document it wrote itself, then asks
 * for it at the shape it is about to assert on; these two helpers are the only
 * place that says so.
 */

/** The JSON body a response carries, at the shape the caller names. */
export async function jsonBody<T>(response: Response): Promise<T> {
  // SAFETY: every caller reads back a fixture its own test served.
  return (await response.json()) as T;
}

/** JSON text or bytes read back at the shape the caller names. */
export function jsonAs<T>(source: string | Uint8Array): T {
  const text = source instanceof Uint8Array ? new TextDecoder().decode(source) : source;
  // SAFETY: every caller reads back a fixture its own test built.
  return JSON.parse(text) as T;
}
